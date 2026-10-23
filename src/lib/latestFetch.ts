import { ApiRequestError } from "./fetcher"

/**
 * 同じ欄の要求を、画面の側で常に1本にするための取得(⑫ ST-8)。
 * ［もう一度読み込む］で出し直すときは、待っている要求を止め(abort)、止めた要求の答えには、出し直した要求の答えを渡す。
 * SWR は止めた要求の失敗も画面の状態(error)に入れるため、止めたことを失敗として返さない。
 * 打ち切り(時間で止めること)はしない。止めるのは、利用者が出し直したときだけ。
 * すでに始まっている要求(ホームの早めの取得)は、adoptStarted で渡されたときだけ、次の取得で1回使う(この取得は、その出どころを知らない)。
 */

/** すでに始まっている要求。promise が undefined で終わったら使わずに取り直す。abort で止められる */
export interface StartedRequest {
  promise: Promise<unknown>
  abort: () => void
}

interface Replacement {
  promise: Promise<unknown>
  resolve: (value: Promise<unknown>) => void
}

const inflight = new Map<string, AbortController>()
/** 止めた要求ごとの、出し直した要求の答え(止めた要求の catch が、次の要求より後に走っても受け取れるように) */
const replacementOf = new WeakMap<AbortController, Replacement>()
/** まだ出し直していない、止めた要求の受け口(key ごと) */
const waiting = new Map<string, Replacement>()

/** key ごとの、まだ使っていない、すでに始まっている要求 */
const started = new Map<string, StartedRequest>()

/** 出し直した要求が来なかったとき、止めた要求を失敗として返すまでの時間(ms) */
export const REPLACEMENT_WAIT_MS = 10_000

/** すでに始まっている要求を、key の次の取得で1回だけ使うように渡す(前に渡したものがあれば止めて置き換える) */
export function adoptStarted(key: string, request: StartedRequest): void {
  started.get(key)?.abort()
  started.set(key, request)
}

function abortError(): DOMException {
  return new DOMException("止めました", "AbortError")
}

async function fetchJson<T>(key: string, url: string, signal: AbortSignal): Promise<T> {
  const first = started.get(key)
  if (first) {
    started.delete(key)
    // 止めるときは、すでに始まっている要求も一緒に止める(画面の側の要求を1本に保つ)
    const onAbort = () => first.abort()
    signal.addEventListener("abort", onAbort, { once: true })
    try {
      const value = await first.promise
      if (signal.aborted) throw abortError()
      if (value !== undefined) return value as T
    } finally {
      signal.removeEventListener("abort", onAbort)
    }
    if (signal.aborted) throw abortError()
  }
  const res = await fetch(url, { signal })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiRequestError(body?.error ?? `リクエストに失敗しました (${res.status})`, res.status)
  }
  return body as T
}

/** key(欄の名前)ごとに、いちばん新しい要求だけを生かして取得する */
export function fetchLatest<T>(key: string, url: string): Promise<T> {
  const controller = new AbortController()
  inflight.set(key, controller)
  const promise = (async () => {
    try {
      return await fetchJson<T>(key, url, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) throw error
      const replacement = replacementOf.get(controller)
      if (!replacement) throw error
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(error), REPLACEMENT_WAIT_MS)
      })
      try {
        return (await Promise.race([replacement.promise, timeout])) as T
      } finally {
        clearTimeout(timer)
      }
    } finally {
      if (inflight.get(key) === controller) inflight.delete(key)
    }
  })()
  // 止めた要求が待っていれば、この要求の答えを渡す
  const replacement = waiting.get(key)
  if (replacement) {
    waiting.delete(key)
    replacement.resolve(promise)
  }
  return promise
}

/**
 * 待っている要求を止める(出し直しの直前に呼ぶ)。止めた要求は、次に同じ key で出した要求の答えを返す。
 * 待っている要求が無ければ何もしない(false)
 */
export function abortInflight(key: string): boolean {
  const controller = inflight.get(key)
  if (!controller) return false
  let resolve: Replacement["resolve"] = () => {}
  const replacementPromise = new Promise<unknown>((r) => {
    resolve = (value) => r(value)
  })
  const replacement = { promise: replacementPromise, resolve }
  replacementOf.set(controller, replacement)
  waiting.set(key, replacement)
  inflight.delete(key)
  controller.abort()
  return true
}

/** 待っている要求があるか(テスト用) */
export function hasInflight(key: string): boolean {
  return inflight.has(key)
}

/** まだ使っていない、すでに始まっている要求があるか(テスト用) */
export function hasStarted(key: string): boolean {
  return started.has(key)
}
