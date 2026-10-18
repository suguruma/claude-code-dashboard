import { describe, expect, it } from "vitest"
import {
  SEND_MATCH_WINDOW_MS,
  assembleFlow,
  emptySignals,
  pairSends,
  pickLeader,
  type FlowSessionInput,
  type PeerSignal,
  type SendSignal,
  type SessionSignals,
} from "./flowEvents"
import type { FlowEnd, FlowReport } from "./flowTypes"

const SEC = 1000
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0)
const at = (sec: number) => T0 + sec * SEC

const LEADER = "local_leader"
const A = "local_member_a"
const B = "local_member_b"

function session(id: string, patch: Partial<SessionSignals> = {}, title = id): FlowSessionInput {
  return { id, title, signals: { ...emptySignals(), ...patch } }
}

const peer = (sec: number, fromId: string, summary = "要約"): PeerSignal => ({
  t: at(sec),
  fromId,
  source: "local",
  summary,
})
const external = (sec: number, summary = "外部から"): PeerSignal => ({ t: at(sec), fromId: null, source: "external", summary })
const send = (sec: number, target: string, summary = "送信"): SendSignal => ({ t: at(sec), targets: [target], summary })
const tools = (...secs: number[]) => secs.map((s) => ({ t: at(s), ctx: 1000 + s }))

describe("pickLeader", () => {
  const list = [
    { id: "s2", title: "00_リーダー_b", createdAt: 200 },
    { id: "s1", title: "00_リーダー_a", createdAt: 100 },
    { id: "s3", title: "01_メンバー", createdAt: 50 },
    { id: "s4", title: "00_作成日時なし", createdAt: null },
  ]

  it("タイトルが接頭辞で始まるセッションを選び、複数なら作成日時が最も早いもの", () => {
    expect(pickLeader(list, "00_")?.id).toBe("s1")
    expect(pickLeader(list, "00_リーダー_b")?.id).toBe("s2")
  })

  it("作成日時が分からないものは後ろ。同じなら ID の順", () => {
    expect(pickLeader([list[3], list[0]], "00_")?.id).toBe("s2")
    expect(pickLeader([{ id: "b", title: "00_x", createdAt: 1 }, { id: "a", title: "00_y", createdAt: 1 }], "00_")?.id).toBe("a")
  })

  it("一致が無い・接頭辞が空なら null。接頭辞を変えると別のセッションが指揮役になる", () => {
    expect(pickLeader(list, "99_")).toBeNull()
    expect(pickLeader(list, "")).toBeNull()
    expect(pickLeader(list, "01_")?.id).toBe("s3")
  })
})

describe("pairSends: 送信と受信の順番を保ち、組の数が最も多く、時刻の差の合計が最も小さい対応", () => {
  const matchedOf = (sends: SendSignal[], receipts: PeerSignal[]) => [...pairSends(sends, receipts).matched.entries()].sort((a, b) => a[0] - b[0])

  it("送信が抜けた場合: S1(0秒)・S2(30秒) と受信 R(31秒): R は近い S2 に対応し、S1 が送信側のみ（送信から見る向きだと R が S1 に対応してしまう）", () => {
    const sends = [send(0, A, "S1"), send(30, A, "S2")]
    const { matched, unmatched } = pairSends(sends, [peer(31, LEADER)])
    expect(matched).toEqual(new Map([[0, at(30)]]))
    expect(unmatched.map((s) => s.summary)).toEqual(["S1"])
  })

  it("送信が途中で1つ抜けた場合: S(0)・S(5)・S(10) のうち最初の1つが届かず、R(6)・R(11) だけ届く → R(6) は S(5)、R(11) は S(10)", () => {
    const { matched, unmatched } = pairSends([send(0, A, "届かない"), send(5, A), send(10, A)], [peer(6, LEADER), peer(11, LEADER)])
    expect(matched).toEqual(
      new Map([
        [0, at(5)],
        [1, at(10)],
      ])
    )
    expect(unmatched.map((s) => s.summary)).toEqual(["届かない"])
  })

  it("受信がまとめて遅れて届いた場合: S(0)・S(5)・S(10) に対して R(20)・R(21)・R(22) → 順番どおりに 0→20、5→21、10→22（逆順にならない）", () => {
    const { matched, unmatched } = pairSends([send(0, A), send(5, A), send(10, A)], [peer(20, LEADER), peer(21, LEADER), peer(22, LEADER)])
    expect(matched).toEqual(
      new Map([
        [0, at(0)],
        [1, at(5)],
        [2, at(10)],
      ])
    )
    expect(unmatched).toEqual([])
  })

  it("対応は交差しない: S(0)・S(10) と R(12)・R(40) → 0→12、10→40（10→12、0→40 にはならない）", () => {
    expect(matchedOf([send(0, A), send(10, A)], [peer(12, LEADER), peer(40, LEADER)])).toEqual([
      [0, at(0)],
      [1, at(10)],
    ])
  })

  it("組の数が最も多い対応を先に選ぶ（差の合計だけを見ると、組の少ない対応が選ばれてしまう）", () => {
    // 3組にできる（差の合計 48）が、1組だけ（S(10)–R(20)、差10）のほうが合計は小さい
    const { matched } = pairSends([send(0, A), send(5, A), send(10, A)], [peer(20, LEADER), peer(21, LEADER), peer(22, LEADER)])
    expect(matched.size).toBe(3)
  })

  it("組の数が同じなら、時刻の差の合計が小さいほう: S(0)・S(10) に R(11) だけ → S(10)", () => {
    const { matched, unmatched } = pairSends([send(0, A, "遠い"), send(10, A, "近い")], [peer(11, LEADER)])
    expect(matched).toEqual(new Map([[0, at(10)]]))
    expect(unmatched.map((s) => s.summary)).toEqual(["遠い"])
  })

  it("送信は受信より前: 受信が送信より前の組は対応しない。同時刻は対応する", () => {
    const early = pairSends([send(20, A)], [peer(18, LEADER)])
    expect(early.matched.size).toBe(0)
    expect(early.unmatched).toHaveLength(1)
    expect(pairSends([send(20, A)], [peer(20, LEADER)]).matched).toEqual(new Map([[0, at(20)]]))
  })

  it("差が60秒以内なら対応し、超えると対応しない（送信側のみ・受信は対応なし）", () => {
    expect(pairSends([send(0, A)], [peer(10, LEADER)])).toEqual({ matched: new Map([[0, at(0)]]), unmatched: [] })
    expect(pairSends([send(0, A)], [peer(SEND_MATCH_WINDOW_MS / SEC, LEADER)]).matched.size).toBe(1)
    const beyond = pairSends([send(0, A)], [peer(SEND_MATCH_WINDOW_MS / SEC + 1, LEADER)])
    expect(beyond.matched.size).toBe(0)
    expect(beyond.unmatched).toHaveLength(1)
  })

  it("1つの送信は2つの受信に対応しない。1つの受信に2つの送信も対応しない", () => {
    const one = pairSends([send(10, A)], [peer(11, LEADER), peer(12, LEADER)])
    expect(one.matched).toEqual(new Map([[0, at(10)]]))
    const two = pairSends([send(10, A), send(12, A)], [peer(14, LEADER)])
    expect(two.matched).toEqual(new Map([[0, at(12)]]))
    expect(two.unmatched).toHaveLength(1)
  })

  it("送信と受信が同数で近いときは、時刻の順に1対1で対応する", () => {
    const { matched, unmatched } = pairSends([send(100, A), send(130, A)], [peer(102, LEADER), peer(133, LEADER)])
    expect(matched).toEqual(new Map([[0, at(100)], [1, at(130)]]))
    expect(unmatched).toEqual([])
  })

  it("窓を超えて離れた2つのやりとりは、別々に対応する", () => {
    expect(matchedOf([send(0, A), send(1000, A)], [peer(3, LEADER), peer(1004, LEADER)])).toEqual([
      [0, at(0)],
      [1, at(1000)],
    ])
  })

  it("入力が空なら、何も対応しない。受信が時刻の昇順でなくても、時刻の順に対応する", () => {
    expect(pairSends([], [])).toEqual({ matched: new Map(), unmatched: [] })
    expect(pairSends([send(5, A)], [])).toEqual({ matched: new Map(), unmatched: [send(5, A)] })
    expect(pairSends([], [peer(5, LEADER)])).toEqual({ matched: new Map(), unmatched: [] })
    const { matched } = pairSends([send(0, A)], [peer(20, LEADER), peer(5, LEADER)])
    expect(matched).toEqual(new Map([[1, at(0)]]))
  })

  it("送信の順が時刻の昇順でなくても、unmatched は入力の順で返る", () => {
    const { unmatched } = pairSends([send(300, A, "後"), send(100, A, "前")], [])
    expect(unmatched.map((s) => s.summary)).toEqual(["後", "前"])
  })

  it("多数（2000件ずつ）の連続した送信・受信でも、時間内に終わり、すべて順番どおりに対応する", () => {
    const sends = Array.from({ length: 2000 }, (_, i) => send(i * 2, A))
    const receipts = Array.from({ length: 2000 }, (_, i) => peer(i * 2 + 1, LEADER))
    const startedAt = Date.now()
    const { matched, unmatched } = pairSends(sends, receipts)
    expect(Date.now() - startedAt).toBeLessThan(5000)
    expect(unmatched).toEqual([])
    expect(matched.size).toBe(2000)
    expect(matched.get(1999)).toBe(at(1999 * 2))
  })
})

describe("assembleFlow: 対応づけが指示の出来事に反映される", () => {
  it("送信が1つ抜けて、受信が1つだけ: 受信は近い送信に対応し（sentAt がその送信の時刻）、抜けた送信は送信側のみの指示として残る", () => {
    const result = assembleFlow({
      leader: session(LEADER, { sends: [send(0, A, "S1"), send(30, A, "S2")] }),
      members: [session(A, { peers: [peer(31, LEADER, "S2の要約")] })],
      since: at(0),
    })
    expect(result.events.map((e) => (e.kind === "instruct" ? [e.receipt, e.sentAt, e.t] : e.kind))).toEqual([
      ["sender-only", at(0), at(0)],
      ["confirmed", at(30), at(31)],
    ])
  })

  it("受信がまとめて遅れて届く: 3つの指示は、順番どおりの送信の時刻（sentAt）を持つ", () => {
    const result = assembleFlow({
      leader: session(LEADER, { sends: [send(0, A, "1つ目"), send(5, A, "2つ目"), send(10, A, "3つ目")] }),
      members: [session(A, { peers: [peer(20, LEADER, "1つ目"), peer(21, LEADER, "2つ目"), peer(22, LEADER, "3つ目")] })],
      since: at(0),
    })
    expect(result.events.map((e) => (e.kind === "instruct" ? [e.summary, e.receipt, e.sentAt] : e.kind))).toEqual([
      ["1つ目", "confirmed", at(0)],
      ["2つ目", "confirmed", at(5)],
      ["3つ目", "confirmed", at(10)],
    ])
  })
})

describe("assembleFlow: 受信の記録が遅れて書かれる前後で、同じ指示だと分かる（sentAt）", () => {
  it("送信側のみのときの t（送信記録の時刻）と、確認済みになったあとの sentAt が同じ。受け手の記録の時刻は t に出る", () => {
    const sends = [send(100, A, "依頼です")]
    const before = assembleFlow({ leader: session(LEADER, { sends }), members: [session(A)], since: at(0) })
    const after = assembleFlow({
      leader: session(LEADER, { sends }),
      members: [session(A, { peers: [peer(102, LEADER, "依頼です")] })],
      since: at(0),
    })
    expect(before.events).toEqual([{ kind: "instruct", t: at(100), from: LEADER, to: A, summary: "依頼です", receipt: "sender-only", sentAt: at(100) }])
    expect(after.events).toEqual([{ kind: "instruct", t: at(102), from: LEADER, to: A, summary: "依頼です", receipt: "confirmed", sentAt: at(100) }])
  })

  it("同じ宛先への2つの送信: 1つ目だけ受信が確認できたとき、2つ目は送信側のまま。あとで2つ目の受信が書かれても、それぞれ自分の送信記録の時刻を持つ", () => {
    const sends = [send(100, A, "1つ目"), send(130, A, "2つ目")]
    const first = assembleFlow({ leader: session(LEADER, { sends }), members: [session(A, { peers: [peer(102, LEADER)] })], since: at(0) })
    expect(first.events.map((e) => (e.kind === "instruct" ? [e.receipt, e.sentAt] : e.kind))).toEqual([
      ["confirmed", at(100)],
      ["sender-only", at(130)],
    ])
    const both = assembleFlow({ leader: session(LEADER, { sends }), members: [session(A, { peers: [peer(102, LEADER), peer(133, LEADER)] })], since: at(0) })
    expect(both.events.map((e) => (e.kind === "instruct" ? [e.receipt, e.sentAt] : e.kind))).toEqual([
      ["confirmed", at(100)],
      ["confirmed", at(130)],
    ])
  })

  it("対応する送信記録が無い（人の入力で動いたなど）受信の記録は、sentAt が null", () => {
    const result = assembleFlow({ leader: session(LEADER), members: [session(A, { peers: [peer(10, LEADER)] })], since: at(0) })
    expect(result.events[0]).toMatchObject({ receipt: "confirmed", sentAt: null })
  })
})

describe("assembleFlow: 指示", () => {
  it("子の会話ログの peer 行（送り手が指揮役）1つから、受信確認ありの指示が1つできる", () => {
    const result = assembleFlow({
      leader: session(LEADER),
      members: [session(A, { peers: [peer(10, LEADER, "最初の依頼")] })],
      since: at(0),
    })
    expect(result.events).toEqual([
      { kind: "instruct", t: at(10), from: LEADER, to: A, summary: "最初の依頼", receipt: "confirmed", sentAt: null },
    ])
  })

  it("指揮役以外からの peer 行は指示にしない（子どうし・他グループ）", () => {
    const result = assembleFlow({
      leader: session(LEADER),
      members: [session(A, { peers: [peer(10, B), peer(11, "local_other")] })],
      since: at(0),
    })
    expect(result.events.filter((e) => e.kind === "instruct")).toEqual([])
  })

  it("受け手に対応する行が無い送信は、送信側のみ（sender-only）の指示になる。宛先は ID でもタイトルでも一致する", () => {
    const result = assembleFlow({
      leader: session(LEADER, { sends: [send(5, A, "IDで送信"), send(6, "メンバーB", "名前で送信")] }),
      members: [session(A), session(B, {}, "メンバーB")],
      since: at(0),
    })
    expect(result.events).toEqual([
      { kind: "instruct", t: at(5), from: LEADER, to: A, summary: "IDで送信", receipt: "sender-only", sentAt: at(5) },
      { kind: "instruct", t: at(6), from: LEADER, to: B, summary: "名前で送信", receipt: "sender-only", sentAt: at(6) },
    ])
  })

  it("対応する peer 行（60秒以内の最も近いもの）があれば受信確認あり1つだけ。二重に出さない", () => {
    const result = assembleFlow({
      leader: session(LEADER, { sends: [send(10, A)] }),
      members: [session(A, { peers: [peer(15, LEADER, "届いた要約")] })],
      since: at(0),
    })
    expect(result.events).toHaveLength(1)
    // 受け手の記録の時刻(15秒)が t。対応した送信記録の時刻(10秒)が sentAt（送信側のみで出していた指示と、同じ指示だと分かる）
    expect(result.events[0]).toMatchObject({ kind: "instruct", t: at(15), summary: "届いた要約", receipt: "confirmed", sentAt: at(10) })
  })

  it("60秒を超えて離れた送信は別の指示とみなす。1つの peer 行に2つの送信は対応づけない", () => {
    const far = assembleFlow({
      leader: session(LEADER, { sends: [send(10, A)] }),
      members: [session(A, { peers: [peer(10 + SEND_MATCH_WINDOW_MS / SEC + 1, LEADER)] })],
      since: at(0),
    })
    expect(far.events.map((e) => (e.kind === "instruct" ? e.receipt : e.kind)).sort()).toEqual(["confirmed", "sender-only"])

    const two = assembleFlow({
      leader: session(LEADER, { sends: [send(10, A), send(12, A)] }),
      members: [session(A, { peers: [peer(14, LEADER)] })],
      since: at(0),
    })
    expect(two.events.map((e) => (e.kind === "instruct" ? e.receipt : e.kind)).sort()).toEqual(["confirmed", "sender-only"])
  })
})

describe("assembleFlow: 報告と報告なしで終了", () => {
  const leaderWith = (reports: PeerSignal[]) => session(LEADER, { peers: reports })

  it("同じ子への次の指示までに、子から指揮役への報告があれば1組。作業量は指示から報告までのツール呼び出し回数", () => {
    const result = assembleFlow({
      leader: leaderWith([peer(100, A)]),
      members: [session(A, { peers: [peer(10, LEADER)], tools: tools(5, 11, 20, 30, 100, 101) })],
      since: at(0),
    })
    const report = result.events.find((e): e is FlowReport => e.kind === "report")!
    expect(report).toEqual({
      kind: "report",
      t: at(100),
      from: A,
      to: LEADER,
      instructAt: at(10),
      tools: 4, // 11・20・30・100（指示より前の5と、報告のあとの101は数えない）
      durationMs: 90 * SEC,
    })
    expect(result.events.some((e) => e.kind === "end")).toBe(false)
  })

  it("同じ窓の2通目以降の報告・最初の指示より前の報告は、線は描くが組にならず、作業量は0", () => {
    const result = assembleFlow({
      leader: leaderWith([peer(3, A), peer(60, A), peer(80, A)]),
      members: [session(A, { peers: [peer(10, LEADER)], tools: tools(20, 30) })],
      since: at(0),
    })
    const reports = result.events.filter((e): e is FlowReport => e.kind === "report")
    expect(reports.map((r) => [r.t / SEC - T0 / SEC, r.instructAt === null ? null : (r.instructAt - T0) / SEC, r.tools])).toEqual([
      [3, null, 0],
      [60, 10, 2],
      [80, null, 0],
    ])
  })

  it("報告が付かない指示は、子のターンが終わっていれば end（報告なしで終了）。終わっていなければ何も出さない", () => {
    const ended = assembleFlow({
      leader: session(LEADER),
      members: [session(A, { peers: [peer(10, LEADER)], tools: tools(12, 14), turnEnds: [at(20)] })],
      since: at(0),
    })
    const end = ended.events.find((e): e is FlowEnd => e.kind === "end")!
    expect(end).toEqual({ kind: "end", t: at(20), sid: A, instructAt: at(10), tools: 2, durationMs: 10 * SEC })

    const pending = assembleFlow({
      leader: session(LEADER),
      members: [session(A, { peers: [peer(10, LEADER)], tools: tools(12, 14) })],
      since: at(0),
    })
    expect(pending.events.filter((e) => e.kind === "end")).toEqual([])
  })

  it("報告が付いた指示には end を出さない。終了は次の指示より前のものだけを、その指示の終了とする", () => {
    const result = assembleFlow({
      leader: leaderWith([peer(30, A)]),
      members: [
        session(A, {
          peers: [peer(10, LEADER), peer(50, LEADER), peer(90, LEADER)],
          tools: tools(12, 55, 56),
          // 20: 1つ目の指示（報告あり）の途中で終わったターン。 70: 2つ目の指示の終了。 100: 3つ目の指示の終了
          turnEnds: [at(5), at(20), at(70), at(100)],
        }),
      ],
      since: at(0),
    })
    const ends = result.events.filter((e): e is FlowEnd => e.kind === "end")
    expect(ends.map((e) => [(e.t - T0) / SEC, (e.instructAt - T0) / SEC, e.tools])).toEqual([
      [70, 50, 2],
      [100, 90, 0],
    ])
  })
})

describe("assembleFlow: 他グループ・外部からの連絡", () => {
  it("グループ外の Desktop セッションは other-group、CLI などは external。子・自分・手戻しの形式は出さない", () => {
    const leader = session(LEADER, {
      peers: [
        peer(1, "local_other", "他グループの依頼"),
        external(2, "CLIから"),
        peer(3, A, "子からの報告"),
        peer(4, LEADER, "自分から"),
        { t: at(5), fromId: null, source: "other", summary: "手戻し" },
      ],
    })
    const result = assembleFlow({ leader, members: [session(A)], since: at(0) })
    expect(result.events.filter((e) => e.kind === "cross")).toEqual([
      { kind: "cross", t: at(1), to: LEADER, source: "other-group", summary: "他グループの依頼" },
      { kind: "cross", t: at(2), to: LEADER, source: "external", summary: "CLIから" },
    ])
  })
})

describe("assembleFlow: ツール呼び出し・圧縮・範囲", () => {
  it("ツール呼び出しは、同じセッションの5秒ごとにまとめる（回数・最後のコンテキスト）。指揮役の分も含む", () => {
    const result = assembleFlow({
      leader: session(LEADER, { tools: [{ t: at(1), ctx: 100 }] }),
      members: [
        session(A, {
          tools: [
            { t: at(10.0), ctx: 200 },
            { t: at(11.0), ctx: 210 },
            { t: at(14.9), ctx: null },
            { t: at(15.0), ctx: 300 },
          ],
        }),
      ],
      since: at(0),
    })
    expect(result.tools).toEqual([
      { t: at(1), sid: LEADER, ctx: 100, n: 1 },
      { t: at(14.9), sid: A, ctx: 210, n: 3 },
      { t: at(15), sid: A, ctx: 300, n: 1 },
    ])
  })

  it("圧縮は compact の出来事になる。since より前のコンテキストは、最後の値（圧縮が後なら圧縮後の量）", () => {
    const result = assembleFlow({
      leader: session(LEADER),
      members: [
        session(A, {
          tools: [
            { t: at(1), ctx: 500 },
            { t: at(2), ctx: 900 },
            { t: at(20), ctx: 120 },
          ],
          compacts: [{ t: at(3), pre: 900, post: 80 }],
        }),
        session(B, { tools: [{ t: at(1), ctx: 700 }] }),
      ],
      since: at(10),
    })
    expect(result.contextBefore.get(A)).toBe(80)
    expect(result.contextBefore.get(B)).toBe(700)
    expect(result.contextBefore.get(LEADER)).toBeNull()
    // since より前の圧縮は出来事に含めない
    expect(result.events.filter((e) => e.kind === "compact")).toEqual([])
    expect(result.tools).toEqual([{ t: at(20), sid: A, ctx: 120, n: 1 }])

    const inRange = assembleFlow({
      leader: session(LEADER),
      members: [session(A, { compacts: [{ t: at(3), pre: 900, post: 80 }] })],
      since: at(0),
    })
    expect(inRange.events).toEqual([{ kind: "compact", t: at(3), sid: A, pre: 900, post: 80 }])
  })

  it("範囲より前の指示・報告は出さないが、組の判定には使う（範囲内の報告の instructAt は範囲より前になりうる）", () => {
    const result = assembleFlow({
      leader: session(LEADER, { peers: [peer(100, A)] }),
      members: [session(A, { peers: [peer(10, LEADER)], tools: tools(20, 30) })],
      since: at(50),
    })
    expect(result.events).toEqual([
      { kind: "report", t: at(100), from: A, to: LEADER, instructAt: at(10), tools: 2, durationMs: 90 * SEC },
    ])
  })

  it("指揮役がいなければ、指示・報告・終了・他グループの出来事は作らない（ツールと圧縮は残る）", () => {
    const result = assembleFlow({
      leader: null,
      members: [
        session(A, {
          peers: [peer(10, LEADER), external(11)],
          tools: tools(12),
          compacts: [{ t: at(13), pre: 2, post: 1 }],
          turnEnds: [at(14)],
        }),
      ],
      since: at(0),
    })
    expect(result.events.map((e) => e.kind)).toEqual(["compact"])
    expect(result.tools).toHaveLength(1)
  })

  it("出来事は時刻の昇順。同じ時刻は 指示→終了→報告 の順", () => {
    const result = assembleFlow({
      leader: session(LEADER, { peers: [peer(30, A), peer(5, "local_other")] }),
      members: [session(A, { peers: [peer(10, LEADER)] }), session(B, { peers: [peer(30, LEADER)], turnEnds: [at(30)] })],
      since: at(0),
    })
    expect(result.events.map((e) => [(e.t - T0) / SEC, e.kind])).toEqual([
      [5, "cross"],
      [10, "instruct"],
      [30, "instruct"],
      [30, "end"],
      [30, "report"],
    ])
  })
})

describe("assembleFlow: 3層目", () => {
  const SUB = "local_sub"
  const SUB2 = "local_sub2"

  it("3層目と親（2層目の子）の間の指示・報告・報告なしの終了は、2層目と同じ規則で出る（送り手・受け手は親）", () => {
    const result = assembleFlow({
      leader: session(LEADER),
      members: [session(A, { sends: [send(20, SUB, "親から子へ")], peers: [peer(70, SUB)] })],
      subs: [{ parentId: A, session: session(SUB, { peers: [peer(21, A, "親から子へ")], tools: tools(30, 40, 50), turnEnds: [at(80)] }) }],
      since: at(0),
    })
    expect(result.events).toEqual([
      { kind: "instruct", t: at(21), from: A, to: SUB, summary: "親から子へ", receipt: "confirmed", sentAt: at(20) },
      { kind: "report", t: at(70), from: SUB, to: A, instructAt: at(21), tools: 3, durationMs: 49 * SEC },
    ])

    const noReport = assembleFlow({
      leader: session(LEADER),
      members: [session(A)],
      subs: [{ parentId: A, session: session(SUB, { peers: [peer(21, A)], tools: tools(30, 40), turnEnds: [at(60)] }) }],
      since: at(0),
    })
    expect(noReport.events.map((e) => e.kind)).toEqual(["instruct", "end"])
    expect(noReport.events[1]).toMatchObject({ kind: "end", sid: SUB, tools: 2 })
  })

  it("指揮役が3層目へ送ったように見える記録・指揮役以外の peer は、3層目の指示にしない。受信の記録が無ければ、親の送信側のみ", () => {
    const result = assembleFlow({
      leader: session(LEADER, { sends: [send(10, SUB, "指揮役が直接送った")] }),
      members: [session(A, { sends: [send(20, SUB, "親が送った")] })],
      subs: [{ parentId: A, session: session(SUB, { peers: [peer(12, LEADER, "指揮役から")] }) }],
      since: at(0),
    })
    const instructs = result.events.filter((e) => e.kind === "instruct")
    // 3層目 SUB の指示になるのは、親 A からのものだけ（A の送信記録は、受け手の記録が無いので、送信側のみ）
    expect(instructs).toEqual([{ kind: "instruct", t: at(20), from: A, to: SUB, summary: "親が送った", receipt: "sender-only", sentAt: at(20) }])
  })

  it("3層目から指揮役への連絡は、他グループの連絡にしない（木の中のセッション）。木に無い local の送り手だけが他グループ", () => {
    const result = assembleFlow({
      leader: session(LEADER, { peers: [peer(10, SUB, "3層目から"), peer(11, "local_elsewhere", "別グループ")] }),
      members: [session(A)],
      subs: [{ parentId: A, session: session(SUB) }],
      since: at(0),
    })
    expect(result.events).toEqual([{ kind: "cross", t: at(11), to: LEADER, source: "other-group", summary: "別グループ" }])
  })

  it("3層目のツール呼び出し・圧縮・コンテキストも、2層目と同じように集める", () => {
    const result = assembleFlow({
      leader: session(LEADER),
      members: [session(A, { tools: tools(5) })],
      subs: [{ parentId: A, session: session(SUB, { tools: tools(6, 7), compacts: [{ t: at(8), pre: 900, post: 100 }] }) }],
      since: at(6),
    })
    expect(result.tools.map((b) => b.sid).sort()).toEqual([SUB])
    expect(result.events).toEqual([{ kind: "compact", t: at(8), sid: SUB, pre: 900, post: 100 }])
    expect(result.contextBefore.get(SUB)).toBeNull()
    expect(result.contextBefore.get(A)).toBe(1005)
  })

  it("同じ親の3層目が複数あっても、それぞれの指示・報告を別に組み立てる。親が members に無い3層目の出来事は作らない", () => {
    const result = assembleFlow({
      leader: session(LEADER),
      members: [session(A, { peers: [peer(30, SUB), peer(31, SUB2)] })],
      subs: [
        { parentId: A, session: session(SUB, { peers: [peer(10, A)] }) },
        { parentId: A, session: session(SUB2, { peers: [peer(12, A)] }) },
        { parentId: "local_nobody", session: session("local_orphan", { peers: [peer(14, "local_nobody")] }) },
      ],
      since: at(0),
    })
    expect(result.events.map((e) => [e.kind, "to" in e ? e.to : "", "from" in e ? e.from : ""])).toEqual([
      ["instruct", SUB, A],
      ["instruct", SUB2, A],
      ["report", A, SUB],
      ["report", A, SUB2],
    ])
  })

  it("指揮役がいなければ木を作らないので、3層目が渡されても無視する（出来事もツールも出ない）", () => {
    const result = assembleFlow({
      leader: null,
      members: [session(A)],
      subs: [{ parentId: A, session: session(SUB, { peers: [peer(5, A)], tools: tools(6) }) }],
      since: at(0),
    })
    expect(result.events).toEqual([])
    expect(result.tools).toEqual([])
  })
})
