import { describe, expect, it } from "vitest"
import { makeSessionSummary } from "./desktopFixtures"
import type { DesktopSessionMessaging, DesktopSessionSummary } from "./desktopSessionTypes"
import type { FlowEvent, FlowInstruct } from "./flowTypes"
import { assembleFlow, emptySignals, type SessionSignals } from "./flowEvents"
import {
  cacheStateOf,
  collectDecisions,
  findUnanswered,
  percentRange,
  resumeCostUsd,
  selectCleanupCandidates,
  type CleanupInput,
} from "./housekeeping"
import { CACHE_TTL_MS, DEFAULT_HOUSEKEEPING_THRESHOLDS } from "./housekeepingTypes"
import { PriceBook } from "./usagePricing"
import type { UsageCalibration } from "./usageTypes"

const NOW = 1_800_000_000_000
const MIN = 60_000
const HOUR = 60 * MIN
const prices = new PriceBook()

const calibration = (low: number, high: number | null): UsageCalibration => ({
  costPerPercentLow: low,
  costPerPercentHigh: high,
  mode: "intersect",
  samples: 2,
})

function candidateInput(sessions: DesktopSessionSummary[], extra: Partial<CleanupInput> = {}): CleanupInput {
  return {
    sessions,
    now: NOW,
    highContextRatio: 0.8,
    thresholds: DEFAULT_HOUSEKEEPING_THRESHOLDS,
    priceOf: (model) => prices.resolve(model),
    fiveHour: null,
    weekly: null,
    ...extra,
  }
}

/** コンテキスト tokens（上限 1,000,000）で、最後の応答が agoMs 前のセッション */
function withContext(id: string, tokens: number, agoMs: number | null, overrides: Partial<DesktopSessionSummary> = {}) {
  return makeSessionSummary(id, {
    context: { tokens, limit: 1_000_000, ratio: tokens / 1_000_000 },
    lastAssistantAt: agoMs === null ? null : NOW - agoMs,
    ...overrides,
  })
}

describe("cacheStateOf", () => {
  it("最後の応答から60分未満は有効、ちょうど60分と、それ以上は切れ。時刻が分からなければ不明", () => {
    expect(cacheStateOf(NOW - (CACHE_TTL_MS - 1), NOW)).toBe("valid")
    expect(cacheStateOf(NOW - CACHE_TTL_MS, NOW)).toBe("expired")
    expect(cacheStateOf(NOW - CACHE_TTL_MS - 1, NOW)).toBe("expired")
    expect(cacheStateOf(NOW, NOW)).toBe("valid")
    expect(cacheStateOf(null, NOW)).toBe("unknown")
  })
})

describe("resumeCostUsd", () => {
  it("コンテキスト量 × 入力単価 × 2（1時間キャッシュの書き込み）÷ 100万。opus の入力単価 4 で 200,000 トークンは 1.60 ドル", () => {
    expect(resumeCostUsd(200_000, { input: 4, output: 20, cacheRead: 0.2 })).toBeCloseTo(1.6, 10)
    expect(resumeCostUsd(0, { input: 4, output: 20, cacheRead: 0.2 })).toBe(0)
    expect(resumeCostUsd(1_000_000, { input: 10, output: 50, cacheRead: 0.25 })).toBeCloseTo(20, 10)
  })
})

describe("percentRange", () => {
  it("金額 ÷ 1%あたりの金額 の幅（low〜high の逆順）", () => {
    // 1%あたり 0.4〜0.5 ドル、金額 1.6 ドル → 3.2〜4%
    expect(percentRange(1.6, calibration(0.4, 0.5))).toEqual({ min: expect.closeTo(3.2, 10), max: expect.closeTo(4, 10) })
  })

  it("上限が無い（公式値が0%だけ）ときは、下限が決まらない。最大だけを返す", () => {
    expect(percentRange(1.6, calibration(0.4, null))).toEqual({ min: null, max: expect.closeTo(4, 10) })
  })

  it("較正が無い・使えない（low が0以下）ときは null", () => {
    expect(percentRange(1.6, null)).toBeNull()
    expect(percentRange(1.6, calibration(0, 1))).toBeNull()
    expect(percentRange(1.6, calibration(-1, 1))).toBeNull()
  })
})

describe("selectCleanupCandidates", () => {
  const select = (sessions: DesktopSessionSummary[], extra: Partial<CleanupInput> = {}) =>
    selectCleanupCandidates(candidateInput(sessions, extra))

  it("大きい: 使用率が 0.8 以上（ちょうど 0.8 を含む）。0.8 未満で止まっていなければ出ない", () => {
    const result = select([
      withContext("big", 800_000, 5 * MIN),
      withContext("almost", 799_999, 5 * MIN),
    ])
    expect(result.map((r) => [r.id, r.reasons])).toEqual([["big", ["large"]]])
  })

  it("長く止まっている: 最後の応答から60分以上（ちょうどを含む）で、コンテキストが 50,000 以上（ちょうどを含む）", () => {
    const result = select([
      withContext("idle", 50_000, HOUR),
      withContext("idle-just-under-time", 100_000, HOUR - 1),
      withContext("idle-just-under-tokens", 49_999, 5 * HOUR),
      withContext("fresh", 300_000, 10 * MIN),
    ])
    expect(result.map((r) => [r.id, r.reasons])).toEqual([["idle", ["idle"]]])
  })

  it("両方に当てはまるものは1行にまとめ、理由を2つ出す", () => {
    const result = select([withContext("both", 900_000, 3 * HOUR)])
    expect(result).toHaveLength(1)
    expect(result[0].reasons).toEqual(["large", "idle"])
  })

  it("アーカイブ済み・実行中・コンテキストの無いセッションは出ない。要対応・中断・入力待ちなどは出る", () => {
    const sessions = [
      withContext("archived", 900_000, 3 * HOUR, { isArchived: true }),
      withContext("running", 900_000, 3 * HOUR, { status: "running" }),
      makeSessionSummary("no-context", { lastAssistantAt: NOW - 3 * HOUR }),
      withContext("blocked", 900_000, 3 * HOUR, { status: "blocked" }),
      withContext("interrupted", 900_000, 3 * HOUR, { status: "interrupted" }),
      withContext("waiting", 900_000, 3 * HOUR, { status: "waiting" }),
    ]
    expect(select(sessions).map((r) => r.id).sort()).toEqual(["blocked", "interrupted", "waiting"])
  })

  it("キャッシュ切れの再開コストは、コンテキスト量×入力単価×2÷100万。有効（60分未満）のときはコストなし", () => {
    const [expired, valid] = select([
      withContext("expired", 200_000, 2 * HOUR, { model: "claude-opus-5-5" }),
      withContext("valid", 900_000, 59 * MIN, { model: "claude-opus-5-5" }),
    ])
    expect(expired.cache).toBe("expired")
    expect(expired.resumeCost?.usd).toBeCloseTo(1.6, 10)
    expect(expired.suggestClear).toBe(true)
    expect(valid.cache).toBe("valid")
    expect(valid.resumeCost).toBeNull()
    expect(valid.suggestClear).toBe(false)
  })

  it("モデルごとの単価で計算する（fable は opus の2.5倍）", () => {
    const result = select([
      withContext("opus", 100_000, 2 * HOUR, { model: "claude-opus-5-5" }),
      withContext("fable", 100_000, 2 * HOUR, { model: "claude-fable-5-1" }),
    ])
    const cost = (id: string) => result.find((r) => r.id === id)?.resumeCost?.usd ?? 0
    expect(cost("fable") / cost("opus")).toBeCloseTo(2.5, 10)
  })

  it("価格表に無いモデル・モデル不明は opus の価格で計算し、その旨を印にする", () => {
    const result = select([
      withContext("unknown-model", 100_000, 2 * HOUR, { model: "claude-future-9" }),
      withContext("no-model", 100_000, 2 * HOUR, { model: null }),
      withContext("known", 100_000, 2 * HOUR, { model: "claude-sonnet-5-5" }),
    ])
    const flag = (id: string) => result.find((r) => r.id === id)?.resumeCost?.priceUnregistered
    expect(flag("unknown-model")).toBe(true)
    expect(flag("no-model")).toBe(true)
    expect(flag("known")).toBe(false)
    expect(result.find((r) => r.id === "unknown-model")?.resumeCost?.usd).toBeCloseTo(0.8, 10)
  })

  it("較正があれば 5時間・週の割合を幅つきで添える。無い枠は null", () => {
    const [item] = select([withContext("a", 200_000, 2 * HOUR)], { fiveHour: calibration(0.4, 0.5), weekly: null })
    expect(item.resumeCost?.fiveHour).toEqual({ min: expect.closeTo(3.2, 10), max: expect.closeTo(4, 10) })
    expect(item.resumeCost?.weekly).toBeNull()
  })

  it("最後の応答の時刻が分からない大きいセッションは、キャッシュ不明で、コストは安全側（切れた場合）で出す", () => {
    const [item] = select([withContext("unknown-time", 900_000, null)])
    expect(item).toMatchObject({ cache: "unknown", idleMs: null, reasons: ["large"], suggestClear: false })
    expect(item.resumeCost?.usd).toBeCloseTo(7.2, 10)
  })

  it("並びは再開コストの大きい順。キャッシュが有効なものは最後で、その中はコンテキストの大きい順", () => {
    const result = select([
      withContext("small-expired", 60_000, 2 * HOUR),
      withContext("valid-big", 950_000, 10 * MIN),
      withContext("big-expired", 400_000, 5 * HOUR),
      withContext("valid-bigger", 990_000, 10 * MIN),
      withContext("mid-expired", 200_000, 3 * HOUR),
    ])
    expect(result.map((r) => r.id)).toEqual(["big-expired", "mid-expired", "small-expired", "valid-bigger", "valid-big"])
  })

  it("しきい値（長く止まっている・最小のコンテキスト）を変えると、判定が変わる", () => {
    const sessions = [withContext("a", 80_000, 2 * HOUR), withContext("b", 200_000, 40 * MIN)]
    expect(select(sessions).map((r) => r.id)).toEqual(["a"])
    const relaxed = select(sessions, { thresholds: { ...DEFAULT_HOUSEKEEPING_THRESHOLDS, idleMs: 30 * MIN, minIdleTokens: 100_000 } })
    expect(relaxed.map((r) => r.id)).toEqual(["b"])
  })
})

// ---------------------------------------------------------------------------

describe("findUnanswered", () => {
  const LEADER = "local_leader"
  const lookup = {
    group: { id: "g1", name: "試験グループ" },
    titleOf: (id: string) => `タイトル(${id})`,
    isWorking: (id: string) => id === "local_busy",
  }
  const instruct = (to: string, agoMin: number, receipt: FlowInstruct["receipt"] = "confirmed", summary = "合成の指示"): FlowInstruct => ({
    kind: "instruct",
    t: NOW - agoMin * MIN,
    from: LEADER,
    to,
    summary,
    receipt,
    sentAt: NOW - agoMin * MIN,
  })
  const report = (from: string, instructAgoMin: number | null, agoMin = 1): FlowEvent => ({
    kind: "report",
    t: NOW - agoMin * MIN,
    from,
    to: LEADER,
    instructAt: instructAgoMin === null ? null : NOW - instructAgoMin * MIN,
    tools: 0,
    durationMs: 0,
  })
  const end = (sid: string, instructAgoMin: number): FlowEvent => ({
    kind: "end",
    t: NOW - (instructAgoMin - 1) * MIN,
    sid,
    instructAt: NOW - instructAgoMin * MIN,
    tools: 0,
    durationMs: 0,
  })
  const find = (events: FlowEvent[], thresholdMs = 30 * MIN) => findUnanswered(events, NOW, thresholdMs, lookup)

  it("報告なしで終了（end）は、30分に満たなくても出る。種類は ended-without-report", () => {
    const result = find([instruct("local_a", 2), end("local_a", 2)])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: "ended-without-report", fromId: LEADER, toId: "local_a", groupId: "g1", groupName: "試験グループ" })
  })

  it("受信を確認できていて、報告も終了も無い指示は、30分以上（ちょうどを含む）で awaiting-report。29分59秒では出ない", () => {
    expect(find([instruct("local_a", 30)])).toMatchObject([{ kind: "awaiting-report", ageMs: 30 * MIN }])
    expect(find([{ ...instruct("local_a", 30), t: NOW - 30 * MIN + 1 }])).toEqual([])
    expect(find([instruct("local_a", 5)])).toEqual([])
  })

  it("送信側のみの指示は、30分以上で possibly-undelivered。それ未満では出ない。受け手が別の用でターンを終えていても、この種類", () => {
    expect(find([instruct("local_a", 45, "sender-only")])).toMatchObject([{ kind: "possibly-undelivered" }])
    expect(find([instruct("local_a", 29, "sender-only")])).toEqual([])
    expect(find([instruct("local_a", 45, "sender-only"), end("local_a", 45)])).toMatchObject([{ kind: "possibly-undelivered" }])
    expect(find([instruct("local_a", 10, "sender-only"), end("local_a", 10)])).toEqual([])
  })

  it("後から報告が付いた指示は出ない（送信側のみの指示に付いた報告も同じ）", () => {
    expect(find([instruct("local_a", 90), report("local_a", 90)])).toEqual([])
    expect(find([instruct("local_a", 90, "sender-only"), report("local_a", 90)])).toEqual([])
  })

  it("報告は、組になった指示にだけ効く。別の子への報告・別の時刻の指示への報告・組にならない報告では、指示は消えない", () => {
    const events = [
      instruct("local_a", 90), // 報告が付く
      instruct("local_b", 90), // 同じ時刻の、別の子への指示。報告が付いていない
      report("local_a", 90),
      instruct("local_c", 60), // 同じ子への、別の時刻の指示（報告が付いていない）
      instruct("local_a", 50),
      report("local_c", null), // 組にならなかった報告
    ]
    expect(find(events).map((r) => [r.toId, r.kind, Math.round(r.ageMs / MIN)])).toEqual([
      ["local_b", "awaiting-report", 90],
      ["local_c", "awaiting-report", 60],
      ["local_a", "awaiting-report", 50],
    ])
  })

  it("1つの指示は1行（報告待ちの指示に終了も付いても、二重に出ない）。古い指示から並ぶ", () => {
    const result = find([instruct("local_a", 40), instruct("local_b", 120), end("local_b", 120), instruct("local_c", 80, "sender-only")])
    expect(result.map((r) => [r.toId, r.kind])).toEqual([
      ["local_b", "ended-without-report"],
      ["local_c", "possibly-undelivered"],
      ["local_a", "awaiting-report"],
    ])
  })

  it("宛先が作業中なら working。タイトルは lookup から引く。要約（20文字まで）をそのまま渡す", () => {
    const [item] = find([instruct("local_busy", 45, "confirmed", "あ".repeat(20) + "…")])
    expect(item).toMatchObject({ working: true, toTitle: "タイトル(local_busy)", fromTitle: `タイトル(${LEADER})` })
    expect(item.summary).toBe("あ".repeat(20) + "…")
  })

  it("しきい値を変えられる", () => {
    expect(find([instruct("local_a", 10)], 5 * MIN)).toHaveLength(1)
    expect(find([instruct("local_a", 100)], 3 * HOUR)).toEqual([])
  })

  it("出来事が無ければ空", () => {
    expect(find([])).toEqual([])
    expect(find([{ kind: "compact", t: NOW, sid: "local_a", pre: 1, post: 1 }])).toEqual([])
  })

  describe("組織図の出来事（assembleFlow）からの抽出", () => {
    // 指揮役→子への指示を、実際の組み立て（送信と受信の対応づけ・報告・終了の判定）にかけて、返事の来ていない指示を取り出す
    const child = { id: "local_child", title: "01_子" }
    const leaderSignals = (sends: [number, string][], reportsAgoMin: number[]): SessionSignals => ({
      ...emptySignals(),
      sends: sends.map(([agoMin, summary]) => ({ t: NOW - agoMin * MIN, targets: [child.id], summary })),
      peers: reportsAgoMin.map((agoMin) => ({ t: NOW - agoMin * MIN, fromId: child.id, source: "local" as const, summary: "" })),
    })
    // 受け手の記録（受信）の本文の要約が、確認できた指示の要約になる
    const childSignals = (receipts: [number, string][], turnEndsAgoMin: number[]): SessionSignals => ({
      ...emptySignals(),
      peers: receipts.map(([agoMin, summary]) => ({ t: NOW - agoMin * MIN, fromId: LEADER, source: "local" as const, summary })),
      turnEnds: turnEndsAgoMin.map((agoMin) => NOW - agoMin * MIN),
    })
    const run = (leader: SessionSignals, member: SessionSignals) => {
      const { events } = assembleFlow({
        leader: { id: LEADER, title: "00_指揮役", signals: leader },
        members: [{ ...child, signals: member }],
        since: NOW - 24 * HOUR,
      })
      return find(events)
    }

    it("報告が付いた指示と、付かなかった指示を取り違えない（連続する3件のうち、真ん中だけ報告なし）", () => {
      const result = run(
        leaderSignals(
          [
            [100, "1件目の指示"],
            [80, "2件目の指示"],
            [60, "3件目の指示"],
          ],
          [95, 55]
        ),
        childSignals(
          [
            [100, "1件目の指示"],
            [80, "2件目の指示"],
            [60, "3件目の指示"],
          ],
          []
        )
      )
      // 報告は、それぞれ直前の指示に付く。2件目（80分前）の指示は、次の指示（60分前）までに報告が無いので、返事が来ていない
      expect(result.map((r) => [r.summary, r.kind])).toEqual([["2件目の指示", "awaiting-report"]])
    })

    it("受け手の記録が無い送信は、30分以上で未達の疑い。受け手に届いて報告が付けば出ない", () => {
      expect(run(leaderSignals([[50, "届かない指示"]], []), childSignals([], []))).toMatchObject([
        { kind: "possibly-undelivered", summary: "届かない指示" },
      ])
      expect(run(leaderSignals([[50, "届いた指示"]], [40]), childSignals([[50, "届いた指示"]], []))).toEqual([])
    })

    it("子のターンが報告なしで終わった指示は、時間にかかわらず出る", () => {
      expect(run(leaderSignals([[5, "すぐ終わった指示"]], []), childSignals([[5, "すぐ終わった指示"]], [3]))).toMatchObject([
        { kind: "ended-without-report", summary: "すぐ終わった指示" },
      ])
    })
  })
})

// ---------------------------------------------------------------------------

describe("collectDecisions", () => {
  const messaging = (over: Partial<DesktopSessionMessaging>): DesktopSessionMessaging => ({
    sent: 0,
    limit: 10,
    stopped: false,
    undelivered: 0,
    exact: true,
    ...over,
  })

  it("要対応（blocked）・エラー・送信上限で停止中・届かなかった送信のセッションを、理由つきで集める。それ以外は出ない", () => {
    const result = collectDecisions([
      makeSessionSummary("blocked", { status: "blocked", needsAction: true, needsActionExcerpt: "承認してください" }),
      makeSessionSummary("error", { status: "error" }),
      makeSessionSummary("stopped", { messaging: messaging({ sent: 10, stopped: true }) }),
      makeSessionSummary("undelivered", { messaging: messaging({ sent: 3, undelivered: 2 }) }),
      makeSessionSummary("completed", { status: "completed" }),
      makeSessionSummary("review", { status: "review_ready" }),
      makeSessionSummary("running", { status: "running", messaging: messaging({ sent: 8 }) }),
      makeSessionSummary("waiting", { status: "waiting" }),
    ])
    expect(result.map((r) => [r.id, r.reasons])).toEqual([
      ["blocked", ["needs-action"]],
      ["stopped", ["send-limit"]],
      ["error", ["error"]],
      ["undelivered", ["undelivered"]],
    ])
    expect(result[0].excerpt).toBe("承認してください")
    expect(result[3].undeliveredCount).toBe(2)
  })

  it("アーカイブ済みは出ない。グループ外・グループ内の両方から集める", () => {
    const result = collectDecisions([
      makeSessionSummary("a", { status: "blocked", group: { id: "g", name: "グループ" }, isArchived: true }),
      makeSessionSummary("b", { status: "blocked", group: { id: "g", name: "グループ" } }),
      makeSessionSummary("c", { status: "blocked", group: null }),
    ])
    expect(result.map((r) => [r.id, r.groupName])).toEqual([
      ["b", "グループ"],
      ["c", null],
    ])
  })

  it("1セッション1行。理由が複数あればバッジが複数（優先度の順）。停止中のセッションは、届かなかった送信を重ねない", () => {
    const result = collectDecisions([
      makeSessionSummary("multi", {
        status: "blocked",
        messaging: messaging({ sent: 10, stopped: true, undelivered: 4 }),
      }),
      makeSessionSummary("error-and-undelivered", { status: "error", messaging: messaging({ undelivered: 1 }) }),
    ])
    expect(result.map((r) => [r.id, r.reasons, r.undeliveredCount])).toEqual([
      ["multi", ["needs-action", "send-limit"], 0],
      ["error-and-undelivered", ["error", "undelivered"], 1],
    ])
  })

  it("並びは、最も優先度の高い理由の順（要対応 → 停止 → エラー → 届かなかった送信）。同じ区分の中では、最後の活動が古い順（不明は最後）", () => {
    const result = collectDecisions([
      makeSessionSummary("undelivered-old", { messaging: messaging({ undelivered: 1 }), lastActivityAt: 100 }),
      makeSessionSummary("error-new", { status: "error", lastActivityAt: 500 }),
      makeSessionSummary("blocked-new", { status: "blocked", lastActivityAt: 900 }),
      makeSessionSummary("blocked-old", { status: "blocked", lastActivityAt: 200 }),
      makeSessionSummary("blocked-unknown", { status: "blocked", lastActivityAt: null }),
      makeSessionSummary("stopped", { messaging: messaging({ stopped: true }), lastActivityAt: 300 }),
      makeSessionSummary("error-old", { status: "error", lastActivityAt: 50 }),
    ])
    expect(result.map((r) => r.id)).toEqual([
      "blocked-old",
      "blocked-new",
      "blocked-unknown",
      "stopped",
      "error-old",
      "error-new",
      "undelivered-old",
    ])
  })

  it("要対応の内容は、要対応のときだけ。エラーのセッションには付けない", () => {
    const [item] = collectDecisions([makeSessionSummary("e", { status: "error", needsActionExcerpt: "前のターンの要約" })])
    expect(item.excerpt).toBeNull()
  })
})
