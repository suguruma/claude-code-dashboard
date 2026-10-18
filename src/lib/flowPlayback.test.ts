import { describe, expect, it } from "vitest"
import {
  CTX_FLASH_MIN_TOKENS,
  IDLE_GAP_MS,
  IDLE_PASS_MS,
  PARTICLE_MAX_RADIUS,
  PARTICLE_MIN_RADIUS,
  WORKING_WINDOW_MS,
  advanceReal,
  buildPlaybackMap,
  buildTimeline,
  describeEvent,
  eventKey,
  eventLines,
  formatCtxDelta,
  formatElapsed,
  leaderPhaseText,
  newEventsAfter,
  particleRadius,
  pulseSeconds,
  selectUnseen,
  shouldAnimate,
  type SeenEvents,
  stateAt,
  timelineMarks,
  workRatio,
} from "./flowPlayback"
import { FLOW_WORK_FULL, type FlowEvent, type FlowMember, type FlowResponse, type FlowToolSample } from "./flowTypes"

const SEC = 1000
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0)
const at = (sec: number) => T0 + sec * SEC

const LEADER = "local_leader"
const A = "local_a"
const B = "local_b"

const members: FlowMember[] = [
  { id: LEADER, title: "00_リーダー", model: null, isLeader: true, parentId: null, contextLimit: 1000, contextBefore: 100 },
  { id: A, title: "01_A", model: null, isLeader: false, parentId: LEADER, contextLimit: 1000, contextBefore: 200 },
  { id: B, title: "02_B", model: null, isLeader: false, parentId: LEADER, contextLimit: 1000, contextBefore: null },
]

function flow(events: FlowEvent[], tools: Array<[number, number, number, number]> = [], generatedAt = at(1000)): FlowResponse {
  return {
    generatedAt,
    since: T0,
    group: { id: "g", name: "試験" },
    leaderId: LEADER,
    prefix: "00_",
    members,
    events,
    // [since からの経過ms, 添字, ctx, n]
    tools: tools.map(([sec, m, ctx, n]) => [sec * SEC, m, ctx, n] as FlowToolSample),
  }
}

const instruct = (sec: number, to: string, summary = "指示"): FlowEvent => ({ kind: "instruct", t: at(sec), from: LEADER, to, summary, receipt: "confirmed", sentAt: null })
const report = (sec: number, from: string, instructSec: number | null, tools = 0): FlowEvent => ({
  kind: "report",
  t: at(sec),
  from,
  to: LEADER,
  instructAt: instructSec === null ? null : at(instructSec),
  tools,
  durationMs: instructSec === null ? 0 : (sec - instructSec) * SEC,
})
const end = (sec: number, sid: string, instructSec: number, tools = 0): FlowEvent => ({
  kind: "end",
  t: at(sec),
  sid,
  instructAt: at(instructSec),
  tools,
  durationMs: (sec - instructSec) * SEC,
})

describe("stateAt: 3層目（子が作った補助のセッション）", () => {
  const C = "local_c" // A の3層目（指示のやりとりがある）
  const D = "local_d" // A の3層目（指示のやりとりが無い。人の入力で動く）
  const withSubs: FlowMember[] = [
    ...members,
    { id: C, title: "補助C", model: null, isLeader: false, parentId: A, contextLimit: 1000, contextBefore: null },
    { id: D, title: "補助D", model: null, isLeader: false, parentId: A, contextLimit: 1000, contextBefore: null },
  ]
  const fromA = (sec: number, to: string): FlowEvent => ({ kind: "instruct", t: at(sec), from: A, to, summary: "Aから", receipt: "confirmed", sentAt: null })
  const toA = (sec: number, from: string, instructSec: number, tools: number): FlowEvent => ({
    kind: "report",
    t: at(sec),
    from,
    to: A,
    instructAt: at(instructSec),
    tools,
    durationMs: (sec - instructSec) * SEC,
  })
  const timeline = buildTimeline({
    ...flow(
      [instruct(10, A), fromA(20, C), toA(80, C, 20, 4), instruct(100, B), report(150, B, 100, 2)],
      [
        [30, 3, 100, 1],
        [40, 3, 110, 1],
        [50, 3, 120, 1],
        [60, 3, 130, 1],
        [300, 4, 50, 1], // D: 指示が無いまま、ツールを呼んでいる
      ]
    ),
    members: withSubs,
  })
  const stateOf = (t: number, id: string) => stateAt(timeline, t).members.find((m) => m.id === id)!

  it("3層目も、親からの指示・報告で、2層目と同じ規則の状態になる（作業中→報告済み。作業量は指示以降の回数）", () => {
    const working = stateOf(at(45), C)
    expect(working.phase).toBe("working")
    expect(working.tools).toBe(2)
    expect(working.lastInstruct).toBe("Aから")
    const reported = stateOf(at(90), C)
    expect(reported.phase).toBe("reported")
    expect(reported.tools).toBe(4)
  })

  it("親からの指示が無くても、直近1分以内にツールを呼んでいれば作業中（作業量は0）。1分を超えると待機", () => {
    expect(stateOf(at(310), D).phase).toBe("working")
    expect(stateOf(at(310), D).tools).toBe(0)
    expect(stateOf(at(310), D).lastInstruct).toBeNull()
    expect(stateOf(at(300) + WORKING_WINDOW_MS, D).phase).toBe("working")
    expect(stateOf(at(300) + WORKING_WINDOW_MS + 1, D).phase).toBe("idle")
    // ツールを呼ぶ前は待機
    expect(stateOf(at(290), D).phase).toBe("idle")
  })

  it("指示が無い2層目の子も、同じ規則で作業中になる（人の入力で動いている子）", () => {
    const t = buildTimeline(flow([], [[100, 2, 10, 1]]))
    expect(stateAt(t, at(110)).members.find((m) => m.id === B)!.phase).toBe("working")
  })

  it("指揮役の「指示・報告」の数は、指揮役自身の分だけ。概要の数は、3層目の出来事も含む", () => {
    const counts = stateAt(timeline, at(200)).counts
    // 指示: 指揮役→A、A→C、指揮役→B の3本。報告: C→A、B→指揮役 の2本
    expect(counts.instructs).toBe(3)
    expect(counts.reports).toBe(2)
    expect(counts.leaderInstructs).toBe(2)
    expect(counts.leaderReports).toBe(1)
  })

  it("作業中の数は、3層目も含む", () => {
    expect(stateAt(timeline, at(45)).counts.working).toBe(1) // C
    expect(stateAt(timeline, at(310)).counts.working).toBe(1) // D
  })

  it("出来事の一覧の文言も、3層目の親子で同じ規則（指示は → 子、報告は ← 子）", () => {
    const title = (id: string) => withSubs.find((m) => m.id === id)?.title ?? id
    expect(describeEvent(fromA(20, C), title)).toMatchObject({ label: "指示", text: expect.stringContaining("→ 補助C") })
    expect(describeEvent(toA(80, C, 20, 4), title)).toMatchObject({ label: "報告", text: expect.stringContaining("← 補助C") })
  })
})

describe("stateAt: カードの状態", () => {
  const timeline = buildTimeline(
    flow(
      [
        instruct(10, A, "最初の依頼"),
        report(100, A, 10, 3),
        instruct(200, A, "二つ目の依頼"),
        end(300, A, 200, 2),
        instruct(400, B, "Bへの依頼"),
        { kind: "compact", t: at(450), sid: B, pre: 950, post: 100 },
      ],
      [
        [20, 1, 300, 1],
        [30, 1, 320, 1],
        [40, 1, 340, 1],
        [250, 1, 500, 1],
        [260, 1, 520, 1],
        [410, 2, 900, 1],
        [440, 2, 940, 1],
        [500, 2, 150, 1],
        [510, 0, 120, 1],
      ]
    )
  )
  const stateOf = (t: number, id: string) => stateAt(timeline, t).members.find((m) => m.id === id)!

  it("指示のあと、直近1分以内にツール呼び出しがあれば作業中。作業量は指示以降の呼び出し回数", () => {
    const s = stateOf(at(45), A)
    expect(s.phase).toBe("working")
    expect(s.tools).toBe(3)
    expect(s.lastInstruct).toBe("最初の依頼")
  })

  it("最後の呼び出しから1分を超えると、結果が出ていなくても待機に戻る（ちょうど1分は作業中）", () => {
    const pending = buildTimeline(flow([instruct(10, A)], [[20, 1, 300, 1], [30, 1, 320, 1]]))
    const phase = (t: number) => stateAt(pending, t).members.find((m) => m.id === A)!.phase
    expect(phase(at(30) + WORKING_WINDOW_MS)).toBe("working")
    expect(phase(at(30) + WORKING_WINDOW_MS + 1)).toBe("idle")
  })

  it("報告が付けば報告済み（作業量は報告の時点まで）。次の指示で、また作業中に戻る", () => {
    const reported = stateOf(at(150), A)
    expect(reported.phase).toBe("reported")
    expect(reported.tools).toBe(3)
    const next = stateOf(at(255), A)
    expect(next.phase).toBe("working")
    expect(next.lastInstruct).toBe("二つ目の依頼")
    expect(next.tools).toBe(1) // 250の呼び出しだけ（260はまだ）
    expect(stateOf(at(265), A).tools).toBe(2)
  })

  it("報告なしで終了した指示は noreport。次の指示が来ると消える", () => {
    expect(stateOf(at(350), A).phase).toBe("noreport")
    expect(stateOf(at(350), A).tools).toBe(2)
    const b = stateOf(at(405), B)
    expect(b.phase).toBe("idle") // 指示は届いたが、まだツールを呼んでいない
    expect(stateOf(at(415), B).phase).toBe("working")
  })

  it("指示が来る前は待機。範囲の始まりより前のコンテキストを使う", () => {
    const s = stateOf(at(5), A)
    expect(s.phase).toBe("idle")
    expect(s.ctx).toBe(200)
    expect(s.lastInstruct).toBeNull()
    expect(stateOf(at(5), B).ctx).toBeNull()
  })

  it("コンテキストは、その時刻までの最後のツール呼び出しの値。圧縮のあとは圧縮後の量", () => {
    expect(stateOf(at(35), A).ctx).toBe(320)
    expect(stateOf(at(445), B).ctx).toBe(940)
    const afterCompact = stateOf(at(460), B)
    expect(afterCompact.ctx).toBe(100)
    expect(afterCompact.lastCompactAt).toBe(at(450))
    // 圧縮のあとに呼び出しがあれば、その値
    expect(stateOf(at(505), B).ctx).toBe(150)
  })

  it("直近1分の呼び出し回数（脈動の速さ）と、最後の出来事の時刻", () => {
    const s = stateOf(at(45), A)
    expect(s.callsPerMinute).toBe(3)
    expect(s.lastEventAt).toBe(at(40))
    const quiet = stateOf(at(150), A)
    expect(quiet.lastEventAt).toBe(at(100)) // 報告
    expect(stateOf(at(5), A).lastEventAt).toBeNull()
  })

  it("指揮役は、直近1分以内にツールを呼んでいれば作業中。作業量は持たない", () => {
    expect(stateOf(at(515), LEADER).phase).toBe("working")
    expect(stateOf(at(515), LEADER).tools).toBe(0)
    expect(stateOf(at(600), LEADER).phase).toBe("idle")
  })

  it("件数は、その時刻までの出来事（指示・報告・終了）と作業中の子の数", () => {
    // 3層目が無ければ、指揮役自身の指示・報告の数は、全体の数と同じ
    expect(stateAt(timeline, at(105)).counts).toEqual({ instructs: 1, reports: 1, ends: 0, working: 0, leaderInstructs: 1, leaderReports: 1 })
    expect(stateAt(timeline, at(255)).counts).toEqual({ instructs: 2, reports: 1, ends: 0, working: 1, leaderInstructs: 2, leaderReports: 1 })
    expect(stateAt(timeline, at(600)).counts).toEqual({ instructs: 3, reports: 1, ends: 1, working: 0, leaderInstructs: 3, leaderReports: 1 })
  })

  it("同じ時刻なら、出来事を順に積み上げた状態と一致する（ライブと振り返りの一貫性）", () => {
    const full = stateAt(timeline, at(255))
    // 範囲の先頭から、その時刻までの出来事・ツールだけを持つタイムラインでも、同じ状態になる
    const cut = {
      ...timeline,
      events: timeline.events.filter((e) => e.t <= at(255)),
      tools: timeline.tools.filter((p) => p.t <= at(255)),
    }
    expect(stateAt(cut, at(255))).toEqual(full)
  })
})

describe("見た目の規則", () => {
  it("増えた分は、1,000トークン以上のときだけ「+28K」の形で出す", () => {
    expect(formatCtxDelta(28_000)).toBe("+28K")
    expect(formatCtxDelta(CTX_FLASH_MIN_TOKENS)).toBe("+1K")
    expect(formatCtxDelta(CTX_FLASH_MIN_TOKENS - 1)).toBeNull()
    expect(formatCtxDelta(-5000)).toBeNull()
    expect(formatCtxDelta(1_500_000)).toBe("+1.5M")
  })

  it("作業量は82回で満杯。粒の半径は、作業量0〜82回以上で最小〜最大の線形", () => {
    expect(workRatio(0)).toBe(0)
    expect(workRatio(FLOW_WORK_FULL / 2)).toBe(0.5)
    expect(workRatio(FLOW_WORK_FULL)).toBe(1)
    expect(workRatio(300)).toBe(1)
    expect(particleRadius(0)).toBe(PARTICLE_MIN_RADIUS)
    expect(particleRadius(FLOW_WORK_FULL)).toBe(PARTICLE_MAX_RADIUS)
    expect(particleRadius(FLOW_WORK_FULL * 3)).toBe(PARTICLE_MAX_RADIUS)
    expect(particleRadius(FLOW_WORK_FULL / 2)).toBeCloseTo((PARTICLE_MIN_RADIUS + PARTICLE_MAX_RADIUS) / 2, 5)
    expect(particleRadius(10)).toBeLessThan(particleRadius(40))
  })

  it("脈動の周期は、直近1分の呼び出しが多いほど短い（0回=1.8秒、30回以上=0.6秒）", () => {
    expect(pulseSeconds(0)).toBeCloseTo(1.8, 5)
    expect(pulseSeconds(30)).toBeCloseTo(0.6, 5)
    expect(pulseSeconds(100)).toBeCloseTo(0.6, 5)
    expect(pulseSeconds(5)).toBeGreaterThan(pulseSeconds(20))
  })

  it("動きを減らす設定のときは動かさない", () => {
    expect(shouldAnimate(false)).toBe(true)
    expect(shouldAnimate(true)).toBe(false)
  })

  it("最後の出来事からの経過: 秒・分・時間", () => {
    expect(formatElapsed(12_000)).toBe("12秒前")
    expect(formatElapsed(59_400)).toBe("59秒前")
    expect(formatElapsed(60_000)).toBe("1分前")
    expect(formatElapsed(59 * 60_000 + 30_000)).toBe("59分前")
    expect(formatElapsed(2 * 3600_000 + 60_000)).toBe("2時間前")
    expect(formatElapsed(-5)).toBe("0秒前")
  })
})

describe("ライブ: 新しい出来事だけを選ぶ", () => {
  const events = [instruct(10, A), report(20, A, 10), instruct(30, B)]
  it("前回までに見た時刻より後の出来事だけ。最初の表示（今を基準にする）では、過去の出来事は何も流さない", () => {
    expect(newEventsAfter(events, at(20)).map((e) => e.t)).toEqual([at(30)])
    expect(newEventsAfter(events, at(5))).toHaveLength(3)
    // 開いた直後: 基準を「いま」にするので、過去の出来事は新しい出来事にならない
    expect(newEventsAfter(events, at(1000))).toEqual([])
  })
})

describe("ライブ: まだ見ていない出来事だけを選ぶ（キーで重複を避ける）", () => {
  it("最初の表示で全件を見たことにすれば、過去の出来事は流れない。あとから増えた出来事と、遅れて書かれた出来事だけが新しい", () => {
    const seen: SeenEvents = new Map()
    const first = [instruct(10, A), report(20, A, 10)]
    selectUnseen(first, seen) // 最初の表示: 呼び出し側は結果を捨てる(流さない)
    expect(selectUnseen(first, seen)).toEqual({ fresh: [], upgraded: [] })

    // 次の取得: 新しい指示と、時刻は古いが今回初めて現れた報告（書き込みが遅れた）
    const next = [instruct(5, B), ...first, instruct(30, B)]
    const { fresh, upgraded } = selectUnseen(next, seen)
    expect(fresh.map((e) => e.t)).toEqual([at(5), at(30)])
    expect(upgraded).toEqual([])
    expect(selectUnseen(next, seen)).toEqual({ fresh: [], upgraded: [] })
  })

  it("キーは種別・時刻・関わるセッションで決まる。同じ時刻でも、宛先が違えば別の出来事", () => {
    expect(eventKey(instruct(10, A))).not.toBe(eventKey(instruct(10, B)))
    expect(eventKey(instruct(10, A))).toBe(eventKey(instruct(10, A, "別の要約")))
    expect(eventKey(report(10, A, 1))).not.toBe(eventKey(end(10, A, 1)))
  })
})

describe("ライブ: 受信未確認で流した指示が、あとで確認済みになっても、粒を2回流さない", () => {
  // 送信側の記録（t=100秒）だけで「受信未確認」の指示を流し、1〜2秒後に受け手の記録（t=102秒）が書かれて確認済みになる
  const senderOnly: FlowEvent = { kind: "instruct", t: at(100), from: LEADER, to: A, summary: "依頼です", receipt: "sender-only", sentAt: at(100) }
  const confirmed: FlowEvent = { kind: "instruct", t: at(102), from: LEADER, to: A, summary: "依頼です", receipt: "confirmed", sentAt: at(100) }

  it("同じ指示のキーは、受信確認の前後で変わらない（受け手の記録の時刻ではなく、送信記録の時刻で見分ける）", () => {
    expect(eventKey(confirmed)).toBe(eventKey(senderOnly))
    // 送信記録が無い確認済みは、自分の時刻で見分ける
    expect(eventKey({ ...confirmed, sentAt: null })).not.toBe(eventKey(senderOnly))
    // 同じ宛先への別の指示（送信記録の時刻が違う）は別の指示
    expect(eventKey({ ...confirmed, sentAt: at(160), t: at(162) })).not.toBe(eventKey(senderOnly))
  })

  it("確認済みになったときは、fresh に出さず、upgraded として返す（1回だけ）。ほかの出来事は、これまでどおり fresh", () => {
    const seen: SeenEvents = new Map()
    selectUnseen([], seen)
    // 1回目の更新: 送信側のみ → 粒を流す
    const first = selectUnseen([senderOnly], seen)
    expect(first.fresh).toEqual([senderOnly])
    expect(first.upgraded).toEqual([])
    // 受け手の記録が書かれた更新: 同じ指示が確認済みになった。粒は流さず、印だけ切り替える
    const second = selectUnseen([confirmed, report(130, A, 102)], seen)
    expect(second.fresh.map((e) => e.kind)).toEqual(["report"])
    expect(second.upgraded).toEqual([confirmed])
    // それ以降の更新では、何も出ない
    expect(selectUnseen([confirmed, report(130, A, 102)], seen)).toEqual({ fresh: [], upgraded: [] })
  })

  it("送信側のみで流していない（最初から確認済みで現れた）指示は、普通に fresh。確認済みから送信側のみには戻らない", () => {
    const seen: SeenEvents = new Map()
    const direct = selectUnseen([confirmed], seen)
    expect(direct.fresh).toEqual([confirmed])
    expect(direct.upgraded).toEqual([])
    // 送信側のみの指示が、確認済みのあとにまた現れても、何も出さない
    expect(selectUnseen([senderOnly], seen)).toEqual({ fresh: [], upgraded: [] })
  })

  it("別の指示（同じ宛先への、送信記録の時刻が違うもの）は、受信未確認が残っていても、別の出来事として流す", () => {
    const seen: SeenEvents = new Map()
    selectUnseen([senderOnly], seen)
    const another: FlowEvent = { kind: "instruct", t: at(132), from: LEADER, to: A, summary: "次の依頼", receipt: "confirmed", sentAt: at(130) }
    const { fresh, upgraded } = selectUnseen([senderOnly, another], seen)
    expect(fresh).toEqual([another])
    expect(upgraded).toEqual([])
  })
})

describe("振り返り: 再生の時間の変換", () => {
  const start = at(0)
  const stop = at(3600)

  it("空き時間を飛ばさないときは、実時間 ÷ 速さ", () => {
    const map = buildPlaybackMap([at(100), at(1000)], start, stop, { speed: 60, skipIdle: false })
    expect(map.totalMs).toBeCloseTo(3600 / 60 * 1000, 3)
    expect(map.toReal(0)).toBe(start)
    expect(map.toReal(map.totalMs)).toBe(stop)
    expect(map.toPlay(at(1800))).toBeCloseTo(30_000, 3)
  })

  it("空き時間を飛ばす: 出来事の間隔が120秒を超える区間だけ、再生にかける時間を2秒までにする（境界120秒・121秒）", () => {
    // 速さ1（実時間のまま）で、境界を確かめる
    const exact = buildPlaybackMap([at(IDLE_GAP_MS / SEC)], start, at(IDLE_GAP_MS / SEC), { speed: 1, skipIdle: true })
    expect(exact.totalMs).toBe(IDLE_GAP_MS) // 120秒ちょうどは飛ばさない
    const over = buildPlaybackMap([], start, at(IDLE_GAP_MS / SEC + 1), { speed: 1, skipIdle: true })
    expect(over.totalMs).toBe(IDLE_PASS_MS) // 121秒は2秒で通過
    // オフなら飛ばさない
    expect(buildPlaybackMap([], start, at(121), { speed: 1, skipIdle: false }).totalMs).toBe(121_000)
  })

  it("速さが速くて、元々2秒より短い区間は、そのまま（再生が長くならない）。長い区間は2秒で通過", () => {
    // ×60: 130秒の空きは自然には2.17秒 → 2秒。×900: 600秒の空きは自然には0.67秒 → そのまま
    const slow = buildPlaybackMap([], start, at(130), { speed: 60, skipIdle: true })
    expect(slow.totalMs).toBe(IDLE_PASS_MS)
    const fast = buildPlaybackMap([], start, at(600), { speed: 900, skipIdle: true })
    expect(fast.totalMs).toBeCloseTo(600_000 / 900, 3)
    const long = buildPlaybackMap([], start, at(3600), { speed: 60, skipIdle: true })
    expect(long.totalMs).toBe(IDLE_PASS_MS)
  })

  it("出来事に挟まれた区間ごとに判断する。再生位置と実時間は、飛ばした区間をまたいでも往復で一致する", () => {
    // 0〜60秒に出来事が密、そのあと2000秒の空き、最後に密
    const marks = [at(10), at(30), at(60), at(2060), at(2070)]
    const map = buildPlaybackMap(marks, start, at(2100), { speed: 60, skipIdle: true })
    // 密な区間: 60秒/60 = 1秒。空き2000秒 → 2秒。残り40秒/60
    expect(map.totalMs).toBeCloseTo(1000 + IDLE_PASS_MS + 40_000 / 60, 3)
    for (const real of [at(0), at(25), at(60), at(1000), at(2060), at(2065), at(2100)]) {
      expect(map.toReal(map.toPlay(real))).toBeCloseTo(real, 0)
    }
    // 空き時間の途中の再生位置は、空きの中の時刻になる
    expect(map.toReal(1000 + IDLE_PASS_MS / 2)).toBeCloseTo(at(60) + 1000 * SEC, -2)
  })

  it("再生を進める: 壁の時間 dt だけ進めた実時間。範囲の端を超えない", () => {
    const marks = [at(60), at(2060)]
    const map = buildPlaybackMap(marks, start, at(2100), { speed: 60, skipIdle: true })
    expect(advanceReal(map, at(0), 500)).toBeCloseTo(at(30), 0)
    // 60秒の出来事の直後に1秒進めると、空き時間（2000秒）の途中へ入る
    const mid = advanceReal(map, at(60), 1000)
    expect(mid).toBeGreaterThan(at(60))
    expect(mid).toBeLessThan(at(2060))
    expect(advanceReal(map, at(2090), 10_000_000)).toBe(at(2100))
  })

  it("出来事・ツール呼び出しのどちらも、空き時間の判断に使う", () => {
    const timeline = buildTimeline(flow([instruct(10, A)], [[500, 1, 300, 1]]))
    expect(timelineMarks(timeline).sort((a, b) => a - b)).toEqual([at(10), at(500)])
  })
})

describe("出来事の一覧の文言", () => {
  const titleOf = (id: string) => members.find((m) => m.id === id)?.title ?? id
  it("種別・色・文言。指示は要約つき、報告の本文は持たない", () => {
    expect(describeEvent(instruct(1, A, "ログインを直して"), titleOf)).toMatchObject({
      label: "指示",
      tone: "down",
      text: "→ 01_A「ログインを直して」",
    })
    expect(describeEvent({ ...(instruct(1, A) as Extract<FlowEvent, { kind: "instruct" }>), receipt: "sender-only" }, titleOf).text).toContain("受信を確認できていません")
    expect(describeEvent(report(61, A, 1, 4), titleOf)).toMatchObject({ label: "報告", tone: "up", text: "← 01_A　ツール4回・1分" })
    expect(describeEvent(report(61, A, null), titleOf).text).toContain("組にならない")
    expect(describeEvent(end(121, A, 1, 7), titleOf)).toMatchObject({ label: "終了", text: "01_A　報告なし（ツール7回・2分）" })
    expect(describeEvent({ kind: "compact", t: at(1), sid: A, pre: 900_000, post: 120_000 }, titleOf).text).toBe("01_A　900K → 120K")
    expect(
      describeEvent({ kind: "cross", t: at(1), to: LEADER, source: "other-group", summary: "確認依頼" }, titleOf)
    ).toMatchObject({ label: "他から", tone: "cross", text: "他のグループから → 00_リーダー「確認依頼」" })
    expect(describeEvent({ kind: "cross", t: at(1), to: LEADER, source: "external", summary: "" }, titleOf).text).toContain("外部（CLI）")
  })

  it("一覧は、その時刻までの出来事を新しい順に、最大 limit 件", () => {
    const events: FlowEvent[] = Array.from({ length: 60 }, (_, i) => instruct(i + 1, A, `指示${i + 1}`))
    const timeline = buildTimeline(flow(events))
    const lines = eventLines(timeline, at(1000), titleOf)
    expect(lines).toHaveLength(50)
    expect(lines[0].text).toContain("指示60")
    expect(eventLines(timeline, at(5), titleOf).map((l) => l.t)).toEqual([at(5), at(4), at(3), at(2), at(1)])
    expect(eventLines(timeline, at(0), titleOf)).toEqual([])
  })
})

describe("leaderPhaseText: 指揮役のカードの状態の文言", () => {
  it("配下の作業中の数は「配下で」と付けて、指揮役自身の作業中と区別する", () => {
    expect(leaderPhaseText(false, 0)).toBe("待機中")
    expect(leaderPhaseText(true, 0)).toBe("作業中")
    expect(leaderPhaseText(false, 3)).toBe("配下で3件が作業中")
    expect(leaderPhaseText(true, 2)).toBe("作業中・配下で2件が作業中")
  })

  it("配下の数は、概要の「作業中」と同じ数（指揮役を除くセッション。3層目を含む）", () => {
    const members: FlowMember[] = [
      { id: "L", title: "00_リーダー", model: null, isLeader: true, parentId: null, contextLimit: 1000, contextBefore: null },
      { id: "A", title: "01_A", model: null, isLeader: false, parentId: "L", contextLimit: 1000, contextBefore: null },
      { id: "C", title: "補助C", model: null, isLeader: false, parentId: "A", contextLimit: 1000, contextBefore: null },
    ]
    const timeline = buildTimeline({
      ...flow([], [[50, 0, 100, 1], [50, 1, 100, 1], [55, 2, 100, 1]]),
      members,
    })
    const state = stateAt(timeline, at(60))
    // 指揮役・2層目・3層目のすべてが、直近1分以内にツールを呼んでいる。配下は2件で、指揮役自身は別に数える
    expect(state.counts.working).toBe(2)
    expect(state.members[0].phase).toBe("working")
    expect(leaderPhaseText(state.members[0].phase === "working", state.counts.working)).toBe("作業中・配下で2件が作業中")
  })
})
