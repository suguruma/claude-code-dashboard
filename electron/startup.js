/**
 * exe の起動の待ち方(遅い PC でも落ちないように)。electron/main.js から使う。Electron に依存しないので、単体で試せる。
 *
 * - 立ち上がりの確かめは、データを読まない軽い入り口(/api/health)に向ける。重いトップページ(/)を確かめに使うと、
 *   1回ごとの打ち切りより描画が遅い PC では、打ち切っては描かせ直すことを繰り返し、いつまでも準備ができない
 * - 全体の待ちに締め切りは置かない。前回の起動の時間から決めた目安(waitBudgetMs)を超えたら、終了せずに、
 *   利用者に「待つ・やめる」を聞く(main.js)。止めるのは、サーバーのプロセスが終わったときと、利用者がやめたときだけ
 * - 段階ごとの時間を startup-stats.json に残し、遅い PC でどこに時間がかかったかを後から見られるようにする
 *   (時間と結果だけを書き、ユーザー名・パスは書かない)
 */
const http = require("http")

/** 立ち上がりの確かめの入り口(src/app/api/health/route.ts。データを読まずに、すぐ 200 を返す) */
const HEALTH_PATH = "/api/health"
/** 確かめの1回ごとの打ち切り。軽い入り口なので、ふつうは数ミリ秒で返る */
const ATTEMPT_TIMEOUT_MS = 5000
/** 確かめをやり直すまでの間 */
const RETRY_DELAY_MS = 300

/** 全体の待ちの目安の下限・倍率・上限。目安を超えても終了はせず、利用者に聞く */
const MIN_WAIT_BUDGET_MS = 60_000
const WAIT_BUDGET_FACTOR = 3
const MAX_WAIT_BUDGET_MS = 10 * 60_000

/** 段階の名前(スプラッシュの進み具合の区切りと同じ) */
const STARTUP_STAGES = ["seed", "spawn", "next-ready", "http-ok", "page-loaded"]

/** 前回の起動の時間から、全体の待ちの目安を決める。前回の3倍、最低60秒、最大10分。記録が無ければ60秒 */
function waitBudgetMs(lastDurationMs) {
  if (typeof lastDurationMs !== "number" || !Number.isFinite(lastDurationMs) || lastDurationMs <= 0) return MIN_WAIT_BUDGET_MS
  return Math.min(MAX_WAIT_BUDGET_MS, Math.max(MIN_WAIT_BUDGET_MS, Math.round(lastDurationMs * WAIT_BUDGET_FACTOR)))
}

/** 1回だけ確かめる。2xx が返れば true。つながらない・打ち切り・それ以外の状態は false */
function probeOnce(port, { path = HEALTH_PATH, timeoutMs = ATTEMPT_TIMEOUT_MS, host = "127.0.0.1" } = {}) {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    const req = http.get({ host, port, path, timeout: timeoutMs }, (res) => {
      res.resume()
      done(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300)
    })
    req.on("error", () => done(false))
    req.on("timeout", () => {
      req.destroy()
      done(false)
    })
  })
}

/**
 * サーバーが答えるまで待つ。締め切りは置かない。
 * stopReason() が文字列を返したら(サーバーのプロセスが終わった・利用者がやめた)、その理由で reject する。
 * onAttempt は、確かめるたびに呼ぶ(数を数えるため。省略可)
 */
function waitForServer(port, options = {}) {
  const {
    path = HEALTH_PATH,
    attemptTimeoutMs = ATTEMPT_TIMEOUT_MS,
    retryDelayMs = RETRY_DELAY_MS,
    stopReason = () => null,
    onAttempt = () => undefined,
  } = options
  return new Promise((resolve, reject) => {
    async function attempt() {
      const before = stopReason()
      if (before) return reject(new Error(before))
      onAttempt()
      const ok = await probeOnce(port, { path, timeoutMs: attemptTimeoutMs })
      if (ok) return resolve()
      const after = stopReason()
      if (after) return reject(new Error(after))
      setTimeout(attempt, retryDelayMs)
    }
    void attempt()
  })
}

/** 起動の始まりからの、段階ごとの時間(ミリ秒)。同じ段階は最初の1回だけ記録する */
function createStageClock(now = Date.now) {
  const startedAt = now()
  const marks = {}
  return {
    mark(stage) {
      if (STARTUP_STAGES.includes(stage) && marks[stage] === undefined) marks[stage] = now() - startedAt
    },
    elapsed() {
      return now() - startedAt
    },
    snapshot() {
      return { ...marks }
    },
  }
}

/**
 * startup-stats.json に書く中身。lastDurationMs は、起動を終えたとき(ok)だけ新しい値にし、
 * やめた・失敗したときは前回の値を残す(次の目安が短くなりすぎないように)。書くのは時間と結果と回数だけ
 */
function buildStartupStats({ previous, outcome, totalMs, stages, waitPrompts, recordedAt }) {
  const prevDuration = typeof previous?.lastDurationMs === "number" && previous.lastDurationMs > 0 ? previous.lastDurationMs : undefined
  const stats = {
    lastDurationMs: outcome === "ok" ? totalMs : prevDuration,
    lastOutcome: outcome,
    lastTotalMs: totalMs,
    lastStages: Object.fromEntries(STARTUP_STAGES.filter((s) => typeof stages?.[s] === "number").map((s) => [s, stages[s]])),
    lastWaitPrompts: waitPrompts ?? 0,
    recordedAt,
  }
  if (stats.lastDurationMs === undefined) delete stats.lastDurationMs
  return stats
}

module.exports = {
  HEALTH_PATH,
  ATTEMPT_TIMEOUT_MS,
  RETRY_DELAY_MS,
  MIN_WAIT_BUDGET_MS,
  MAX_WAIT_BUDGET_MS,
  STARTUP_STAGES,
  waitBudgetMs,
  probeOnce,
  waitForServer,
  createStageClock,
  buildStartupStats,
}
