/**
 * ホームの早めの取得(⑫ ST-7)。静的な HTML の中の小さなスクリプトで、一覧と利用上限の要求を、JS の読み込み・ハイドレーションと
 * 並べて始める(遅い PC では、ハイドレーションが済むまで要求を出せず、その分だけ件数が遅れるため)。
 * 最初の取得(latestFetch)が、この答えを1回だけ使う。失敗した・古い(15秒より前)ときは使わず、ふつうに取り直す。
 * 画面の内での移動でホームを開いたときは、スクリプトは動かない(ふつうの取得になる)。
 */

/** 早めに取る API(ホームの最初の描画で使うもの。組織図はグループが分からないので含めない) */
export const EARLY_FETCH_URLS = ["/api/desktop-sessions", "/api/usage?phase=official", "/api/usage"] as const

/** 早めの答えを使ってよい時間(ms) */
export const EARLY_FETCH_MAX_AGE_MS = 15_000

interface EarlyResult {
  ok: boolean
  status?: number
  body?: unknown
}

interface EarlyStore {
  at: number
  requests: Record<string, Promise<EarlyResult>>
  /** ホームの読み込みの始まりとして at を使ったか(1回だけ使う) */
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
  return `(function(){try{var w=window;if(w.__ccdEarly)return;var r={};${urls}.forEach(function(u){r[u]=fetch(u).then(function(s){return s.json().then(function(b){return{ok:s.ok,status:s.status,body:b}},function(){return{ok:false,status:s.status}})},function(){return{ok:false}})});w.__ccdEarly={at:Date.now(),requests:r}}catch(e){}})()`
}

/**
 * url の早めの答えを1回だけ取り出す(無い・古いときは null)。取り出した後は消す(2回目からはふつうに取る)。
 * 失敗の答え(ok=false)は使わない(ふつうに取り直し、失敗ならそのときの失敗を出す)
 */
export function takeEarly(url: string, now: number = Date.now()): Promise<EarlyResult> | null {
  if (typeof window === "undefined") return null
  const store = window.__ccdEarly
  const request = store?.requests[url]
  if (!store || !request) return null
  delete store.requests[url]
  if (now - store.at > EARLY_FETCH_MAX_AGE_MS) return null
  return request
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
