import { ApiRequestError } from "./fetcher"
import { adoptStarted } from "./latestFetch"

/**
 * ホームの早めの取得(⑫ ST-7)。静的な HTML の中の小さなスクリプトで、一覧と利用上限の要求を、JS の読み込み・ハイドレーションと
 * 並べて始める(遅い PC では、ハイドレーションが済むまで要求を出せず、その分だけ件数が遅れるため)。
 * ホームのページだけが `adoptEarlyRequests` で、その要求を取得(latestFetch)に渡す。取得の側は、早めの取得のことを知らない。
 * - 早めの要求は止められる(［もう一度読み込む］で出し直すとき、ほかの要求と同じく止める)
 * - 古さは、答えが届いた時刻から見る(15秒より前に届いた答えは使わず、取り直す)
 * - サーバーが失敗を返したときは、その失敗を使う(同じ重い要求をもう一度出さない)。つながらなかったときだけ取り直す
 * 画面の内での移動でホームを開いたときは、スクリプトは動かない(ふつうの取得になる)。
 */

/** 早めに取る API(ホームの最初の描画で使うもの。組織図はグループが分からないので含めない)。取得の key と同じ文字列 */
export const EARLY_FETCH_URLS = ["/api/desktop-sessions", "/api/usage?phase=official", "/api/usage"] as const

/** 早めの答えを使ってよい古さ(ms。答えが届いてから) */
export const EARLY_FETCH_MAX_AGE_MS = 15_000

interface EarlyResult {
  ok: boolean
  status?: number
  body?: unknown
  /** 答えが届いた時刻(ms) */
  at?: number
}

interface EarlyRequest {
  promise: Promise<EarlyResult>
  controller?: AbortController
}

interface EarlyStore {
  /** スクリプトが動いた時刻(ms)。読み込みの始まりとして使う */
  at: number
  requests: Record<string, EarlyRequest>
  /** 読み込みの始まりとして at を使ったか(1回だけ使う) */
  startTaken?: boolean
}

declare global {
  interface Window {
    __ccdEarly?: EarlyStore
  }
}

/** 静的な HTML に入れるスクリプト(外のファイルを読まない・外と通信しない。同じオリジンの GET だけ) */
export function earlyFetchScript(): string {
  const urls = JSON.stringify(EARLY_FETCH_URLS)
  return `(function(){try{var w=window;if(w.__ccdEarly)return;var r={};${urls}.forEach(function(u){var c=typeof AbortController==="function"?new AbortController():undefined;r[u]={controller:c,promise:fetch(u,c?{signal:c.signal}:undefined).then(function(s){return s.json().then(function(b){return{ok:s.ok,status:s.status,body:b,at:Date.now()}},function(){return{ok:false,status:s.status,at:Date.now()}})},function(){return{ok:false}})}});w.__ccdEarly={at:Date.now(),requests:r}}catch(e){}})()`
}

/** url の早めの要求を1回だけ取り出す(無いときは null)。取り出した後は消す(2回目からはふつうに取る) */
export function takeEarly(url: string): EarlyRequest | null {
  if (typeof window === "undefined") return null
  const store = window.__ccdEarly
  const request = store?.requests[url]
  if (!store || !request) return null
  delete store.requests[url]
  return request
}

/**
 * 早めの答えを、取得で使える値に直す。使えるときは本文、取り直すときは undefined、サーバーの失敗は ApiRequestError を投げる。
 * now は答えを受け取った時刻
 */
export function resolveEarly(result: EarlyResult, now: number = Date.now()): unknown {
  if (result.at !== undefined && now - result.at > EARLY_FETCH_MAX_AGE_MS) return undefined
  if (result.ok) return result.body
  if (typeof result.status === "number") {
    const message = (result.body as { error?: string } | undefined)?.error
    throw new ApiRequestError(message ?? `リクエストに失敗しました (${result.status})`, result.status)
  }
  return undefined
}

/**
 * ホームの早めの要求を、取得(latestFetch)に渡す。ホームのページだけが、最初の取得より前に1回呼ぶ。
 * 取得の key は URL と同じ。スクリプトが動いていなければ何もしない
 */
export function adoptEarlyRequests(): void {
  for (const url of EARLY_FETCH_URLS) {
    const request = takeEarly(url)
    if (!request) continue
    const promise = request.promise.then((result) => resolveEarly(result))
    // 受け手(最初の取得)が await するまでの間に失敗しても、「処理されない拒否」にしない。受け手が await したときの拒否は、そのまま届く
    promise.catch(() => {})
    adoptStarted(url, { promise, abort: () => request.controller?.abort() })
  }
}

/**
 * 窓を開いて最初に読んだホームの、HTML を読んだ時刻(ms)を1回だけ返す(上のバーの印と30秒の案内は、ここから数える)。
 * 2回目から・古い(15秒より前)・スクリプトが動いていない(画面の内での移動)ときは null
 */
export function takeEarlyStart(now: number = Date.now()): number | null {
  if (typeof window === "undefined") return null
  const store = window.__ccdEarly
  if (!store || store.startTaken) return null
  store.startTaken = true
  if (now - store.at > EARLY_FETCH_MAX_AGE_MS) return null
  return store.at
}
