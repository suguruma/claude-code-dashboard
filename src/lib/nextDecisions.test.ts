import { describe, expect, it } from "vitest"
import { buildDecisionDetail, type DecisionDetailInput } from "./decisionDetail"
import { makeSessionSummary } from "./desktopFixtures"
import type { DesktopNeedsActionInfo, DesktopSessionSummary } from "./desktopSessionTypes"
import { DEFAULT_FILTERS, applyFilters } from "./desktopSessionFilters"
import { collectDecisions } from "./housekeeping"
import {
  LONG_WAIT_MS,
  buildNextDecisions,
  countByUrgency,
  countRest,
  countsText,
  hiddenText,
  interruptedText,
  restText,
  splitPreview,
} from "./nextDecisions"
import { cutAfterMask, maskSecrets, SECRET_MARK } from "./secretMask"
import { applyEntry, createDigest, pendingAskOf, toolPreviewOf, wrapUpDigestOf } from "./transcriptDigest"

const NOW = 1_800_000_000_000
const MIN = 60_000

const needs = (kind: DesktopNeedsActionInfo["kind"], estimated = false): DesktopNeedsActionInfo => ({
  kind,
  source: estimated ? "summary-words" : "wrap-up-ask",
  estimated,
  buttons: [],
})

const blocked = (id: string, kind: DesktopNeedsActionInfo["kind"], waitMin: number, o: Partial<DesktopSessionSummary> = {}) =>
  makeSessionSummary(id, { status: "blocked", needsActionInfo: needs(kind, o.needsActionInfo?.estimated), lastActivityAt: NOW - waitMin * MIN, ...o })

const messaging = (o: Partial<NonNullable<DesktopSessionSummary["messaging"]>>): DesktopSessionSummary["messaging"] => ({
  sent: 0,
  limit: 10,
  stopped: false,
  undelivered: 0,
  exact: true,
  ...o,
})

/** 合成データ(要件メモ 4-2 (a) の11件)と同じ組み合わせ */
function elevenSessions(): DesktopSessionSummary[] {
  return [
    makeSessionSummary("limit", { status: "waiting", messaging: messaging({ sent: 10, stopped: true }), lastActivityAt: NOW - 30 * MIN }),
    blocked("perm", "permission", 20, { needsActionInfo: needs("permission", true) }),
    makeSessionSummary("err", { status: "error", lastActivityAt: NOW - 10 * MIN }),
    blocked("ask-long", "decision", 150),
    blocked("appr-est", "approval", 40, { needsActionInfo: needs("approval", true) }),
    blocked("appr", "approval", 35),
    makeSessionSummary("undeliv", { status: "waiting", messaging: messaging({ sent: 1, undelivered: 1 }), lastActivityAt: NOW - 70 * MIN }),
    blocked("plan", "approval", 66),
    blocked("ask", "decision", 50),
    blocked("ask-est", "decision", 45, { needsActionInfo: needs("decision", true) }),
    blocked("unknown", "unknown", 64),
    // 判断待ちではないもの
    makeSessionSummary("run", { status: "running" }),
    makeSessionSummary("stand", { status: "standby" }),
    makeSessionSummary("intr", { status: "interrupted" }),
    makeSessionSummary("old", { status: "blocked", isArchived: true, needsActionInfo: needs("decision") }),
  ]
}

describe("[A3] [ND-3] 急ぐ順", () => {
  it("合成データの11件が、急ぎ3・今日中5・いつでも3 の段に分かれ、同じ段では待ちの長い順に並ぶ", () => {
    const list = buildNextDecisions(elevenSessions(), NOW)
    expect(list.map((d) => [d.id, d.urgency])).toEqual([
      ["limit", "urgent"],
      ["perm", "urgent"],
      ["err", "urgent"],
      ["ask-long", "today"],
      ["undeliv", "today"],
      ["plan", "today"],
      ["appr-est", "today"],
      ["appr", "today"],
      ["unknown", "anytime"],
      ["ask", "anytime"],
      ["ask-est", "anytime"],
    ])
    expect(countsText(countByUrgency(list))).toBe("11件（急ぎ 3・今日中 5・いつでも 3）")
    // 2時間を超えて今日中に上がったものには、その理由を添える。種類で決まったものには添えない
    expect(list.find((d) => d.id === "ask-long")?.notes).toContain("2時間を超えたので今日中")
    expect(list.find((d) => d.id === "appr")?.notes).not.toContain("2時間を超えたので今日中")
  })

  it("種類の札は7つ。推定は札で示す", () => {
    const list = buildNextDecisions(elevenSessions(), NOW)
    const label = (id: string) => list.find((d) => d.id === id)
    expect(label("limit")?.kindLabel).toBe("送信上限")
    expect(label("perm")).toMatchObject({ kindLabel: "許可", estimated: true })
    expect(label("err")?.kindLabel).toBe("エラー")
    expect(label("undeliv")?.kindLabel).toBe("届かない送信")
    expect(label("appr")).toMatchObject({ kindLabel: "承認", estimated: false })
    expect(label("ask")?.kindLabel).toBe("質問")
    expect(label("unknown")?.kindLabel).toBe("種類不明")
  })

  it("配下(立てたセッション)が入力待ち・待機なら急ぎにし、理由を添える", () => {
    const sessions = [blocked("lead", "decision", 5), makeSessionSummary("child", { status: "waiting", spawnedFromId: "lead" })]
    const [d] = buildNextDecisions(sessions, NOW)
    expect(d.urgency).toBe("urgent")
    expect(d.notes).toContain("立てたセッション 1件が、この答えを待っています")
  })

  it("待ちがちょうど2時間なら今日中、それ未満の質問はいつでも", () => {
    expect(buildNextDecisions([blocked("a", "decision", LONG_WAIT_MS / MIN)], NOW)[0].urgency).toBe("today")
    expect(buildNextDecisions([blocked("a", "decision", LONG_WAIT_MS / MIN - 1)], NOW)[0].urgency).toBe("anytime")
  })

  it("問いの無い種類は、何が起きたかを1文で出す", () => {
    const list = buildNextDecisions(elevenSessions(), NOW)
    expect(list.find((d) => d.id === "limit")?.happened).toBe("送信の上限（10/10）で止まっています。開いて一言入力すると、また送れます。")
    expect(list.find((d) => d.id === "undeliv")?.happened).toBe("送った相手が見つからず、1件が届いていません。")
    expect(list.find((d) => d.id === "err")?.happened).toBe("エラーで止まっています。")
    expect(list.find((d) => d.id === "ask")?.happened).toBeNull()
  })
})

describe("[ND-12] 7日以上そのままのものは「いつでも」の最後(⑬ 報告72 の real1)", () => {
  const DAY = 24 * 60
  it("種類によらず「いつでも」に置き、同じ段の最後に並べ、札「7日以上そのまま」。件数の文は「いつでも n（うち7日以上 m）」", () => {
    const list = buildNextDecisions(
      [
        blocked("perm-old", "permission", 108 * DAY),
        blocked("appr-old", "approval", 7 * DAY),
        blocked("ask", "decision", 30),
        blocked("perm", "permission", 10),
        blocked("appr-6d", "approval", 6 * DAY),
      ],
      NOW
    )
    expect(list.map((d) => [d.id, d.urgency, d.stale])).toEqual([
      ["perm", "urgent", false],
      ["appr-6d", "today", false],
      ["ask", "anytime", false],
      ["perm-old", "anytime", true],
      ["appr-old", "anytime", true],
    ])
    expect(list.find((d) => d.id === "perm-old")?.notes).toContain("7日以上そのまま")
    expect(countsText(countByUrgency(list))).toBe("5件（急ぎ 1・今日中 1・いつでも 3（うち7日以上 2））")
  })
})

describe("[A6] [ND-6] 最初に見せる件数と畳む行", () => {
  it("最初は5件。残りは内訳つきで畳む", () => {
    const list = buildNextDecisions(elevenSessions(), NOW)
    const { shown, hidden } = splitPreview(list)
    expect(shown).toHaveLength(5)
    expect(hiddenText(hidden)).toBe("ほか 6件を出す（今日中 3・いつでも 3）")
  })

  it("急ぎが5件を超えるときは、急ぎを全部出す", () => {
    const many = Array.from({ length: 7 }, (_, i) => blocked(`p${i}`, "permission", i + 1))
    const { shown, hidden } = splitPreview(buildNextDecisions([...many, blocked("q", "decision", 1)], NOW))
    expect(shown).toHaveLength(7)
    expect(hidden.map((d) => d.id)).toEqual(["q"])
  })

  it("判断待ちではないセッションは、状態ごとの件数を1行で。中断した可能性は別の文で出す(D8)", () => {
    const rest = countRest(elevenSessions())
    expect(restText(rest)).toBe("判断待ちではないセッション：作業中 1・待機 1")
    expect(interruptedText(rest)).toBe("中断した可能性（推定）1：再開するかを、セッション一覧で確かめる")
    expect(interruptedText({ ...rest, interrupted: 0 })).toBeNull()
  })
})

describe("[A7] [ND-7] 件数は整理ページの「あなたの対応待ち」と同じ数え方", () => {
  it("collectDecisions と同じ集合・同じ数(アーカイブ・待機は入れない)", () => {
    const sessions = elevenSessions()
    const list = buildNextDecisions(sessions, NOW)
    expect(list.map((d) => d.id).sort()).toEqual(collectDecisions(sessions).map((d) => d.id).sort())
    expect(list.some((d) => d.id === "old" || d.id === "stand")).toBe(false)
  })

  it("セッション一覧の「次にやる判断」の絞り込みも同じ集合になる", () => {
    const sessions = elevenSessions()
    const filtered = applyFilters(sessions, { ...DEFAULT_FILTERS, status: "decisions" }, 0.8)
    expect(filtered.map((s) => s.id).sort()).toEqual(collectDecisions(sessions).map((d) => d.id).sort())
  })
})

const detailInput = (o: Partial<DecisionDetailInput>): DecisionDetailInput => ({
  status: "blocked",
  needsActionInfo: needs("decision"),
  wrapUp: null,
  pendingAsk: null,
  pendingPlanLine: null,
  pendingTool: null,
  summaryText: null,
  errorText: null,
  ...o,
})

describe("[A2] [ND-2] 問いの文の出どころの順", () => {
  const wrapUp = wrapUpDigestOf({ ask: "A案とB案のどちらで進めますか", actions: [{ label: "A案" }, { label: "B案" }] })
  const ask = pendingAskOf({ questions: [{ question: "期限はいつですか", options: [{ label: "今週" }] }] }, "t1")

  it("wrap_up の ask → AskUserQuestion の問い → ExitPlanMode の1行目 → 要約の順", () => {
    const all = { wrapUp, pendingAsk: ask, pendingPlanLine: "設計を変える", summaryText: "要約の文" }
    expect(buildDecisionDetail(detailInput(all))).toMatchObject({ question: "A案とB案のどちらで進めますか", questionSource: "wrap-up" })
    const noWrap = detailInput({ ...all, wrapUp: null, needsActionInfo: { ...needs("decision"), source: "ask-tool" } })
    expect(buildDecisionDetail(noWrap)).toMatchObject({ question: "期限はいつですか", questionSource: "ask-tool" })
    const plan = detailInput({ ...all, wrapUp: null, pendingAsk: null, needsActionInfo: { ...needs("approval"), source: "plan-tool" } })
    expect(buildDecisionDetail(plan)).toMatchObject({ question: "プランの承認：設計を変える", questionSource: "plan" })
    const summary = detailInput({ summaryText: "要約の文", needsActionInfo: needs("decision", true) })
    expect(buildDecisionDetail(summary)).toMatchObject({ question: "要約の文", questionSource: "summary" })
  })

  it("どれも無ければ問いは null(画面は「問いは取れません（開いて読む）」)", () => {
    expect(buildDecisionDetail(detailInput({}))).toMatchObject({ question: null, questionSource: null })
  })

  it("許可待ち(推定)は、要約より先に、結果を待っているツールの呼び出しを出す", () => {
    const d = buildDecisionDetail(
      detailInput({
        needsActionInfo: needs("permission", true),
        pendingTool: { toolUseId: "t", name: "Bash", preview: "npm install" },
        summaryText: "許可を待っています",
      })
    )
    expect(d).toMatchObject({ question: "Bash：npm install", questionSource: "tool", options: [] })
  })

  it("要対応でない(エラー)ときは問いを作らず、エラーの文だけを持つ", () => {
    const d = buildDecisionDetail(detailInput({ status: "error", needsActionInfo: null, errorText: "失敗しました" }))
    expect(d).toMatchObject({ question: null, errorText: "失敗しました" })
  })
})

describe("[A4] [ND-4] 答えの候補と推し", () => {
  it("AskUserQuestion の「(Recommended)」の印の付いた選択肢を推しにし、印は外す", () => {
    const pendingAsk = pendingAskOf(
      { questions: [{ question: "どちら", options: [{ label: "A案" }, { label: "B案 (Recommended)" }] }, { question: "二つ目" }] },
      "t"
    )
    const d = buildDecisionDetail(detailInput({ needsActionInfo: { ...needs("decision"), source: "ask-tool" }, pendingAsk }))
    expect(d).toMatchObject({ options: ["A案", "B案"], recommended: 1, moreQuestions: 1 })
    const ja = pendingAskOf({ questions: [{ question: "q", options: [{ label: "今週（推奨）" }, { label: "来週" }] }] }, "t")
    expect(buildDecisionDetail(detailInput({ needsActionInfo: { ...needs("decision"), source: "ask-tool" }, pendingAsk: ja })).recommended).toBe(0)
  })

  it("wrap_up の ask があるときは、ボタンを候補にし、先頭のボタン(actions[0])を推しにする(道具の説明「recommendation first」)", () => {
    const wrapUp = wrapUpDigestOf({ ask: "どうしますか", actions: [{ label: "コミットする" }, { label: "待つ" }] })
    const d = buildDecisionDetail(detailInput({ needsActionInfo: { ...needs("approval"), source: "wrap-up-action" }, wrapUp }))
    expect(d).toMatchObject({ options: ["コミットする", "待つ"], recommended: 0 })
    const one = wrapUpDigestOf({ ask: "進めますか", actions: [{ label: "進める", message: "進めて" }] })
    expect(buildDecisionDetail(detailInput({ needsActionInfo: { ...needs("decision"), source: "wrap-up-ask" }, wrapUp: one })).recommended).toBe(0)
  })

  it("プランの承認・許可の決まった2択と、要約の言葉だけのものには、候補と推しを出さない", () => {
    const plan = buildDecisionDetail(detailInput({ needsActionInfo: { ...needs("approval"), source: "plan-tool" }, pendingPlanLine: "p" }))
    const perm = buildDecisionDetail(detailInput({ needsActionInfo: needs("permission", true), pendingTool: { toolUseId: "t", name: "Bash", preview: "ls" } }))
    const summary = buildDecisionDetail(detailInput({ needsActionInfo: needs("decision", true), summaryText: "A か B" }))
    for (const d of [plan, perm, summary]) expect(d).toMatchObject({ options: [], recommended: null })
  })
})

describe("[A5] [ND-5] 長さの上限・パスと秘密の隠し方", () => {
  it("答えの候補は5つまで。それより多いときは「ほか n」の数を返す", () => {
    const wrapUp = wrapUpDigestOf({ ask: "どれ", actions: Array.from({ length: 7 }, (_, i) => ({ label: `案${i + 1}` })) })
    const d = buildDecisionDetail(detailInput({ wrapUp }))
    expect(d.options).toEqual(["案1", "案2", "案3", "案4", "案5"])
    expect(d.moreOptions).toBe(2)
  })

  it("問いと候補の中の作業フォルダのパスを、最後の名前にする", () => {
    const wrapUp = wrapUpDigestOf({ ask: String.raw`C:\Users\someone\work\app を消してよいですか`, actions: [{ label: String.raw`D:\data\out に書く` }] })
    const d = buildDecisionDetail(detailInput({ wrapUp }))
    expect(d.question).toBe("app を消してよいですか")
    expect(d.options).toEqual(["out に書く"])
    expect(JSON.stringify(d)).not.toContain("someone")
  })

  it("許可のコマンドは、秘密らしい文字列を伏せてから先頭40字で切る", () => {
    const preview = toolPreviewOf({ command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789" https://example.invalid/api' })
    expect(preview).not.toContain("abcdefghijklmnop")
    expect(preview).toContain(SECRET_MARK)
    expect(preview.replace("…", "").length).toBeLessThanOrEqual(40)
    expect(maskSecrets("token=abc123&x=1")).toBe(`token=${SECRET_MARK}&x=1`)
    expect(maskSecrets("password: hunter2")).toBe(`password: ${SECRET_MARK}`)
    expect(maskSecrets("key sk-ant-abcdefgh1234")).toBe(`key ${SECRET_MARK}`)
    // 切る前に伏せるので、切った後ろに秘密の頭が残らない
    expect(cutAfterMask(`echo ${"x".repeat(30)} ${"A".repeat(30)}`, 40)).not.toContain("AAAA")
  })
})

describe("結果を待っている呼び出しの取り込み（⑬）", () => {
  const assistant = (tools: Array<{ id: string; name: string; input: Record<string, unknown> }>) => ({
    type: "assistant",
    message: { stop_reason: "tool_use", content: tools.map((t) => ({ type: "tool_use", ...t })) },
  })
  const result = (id: string) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } })

  it("AskUserQuestion とプランは、結果が来たら外れる。新しい入力でも外れる", () => {
    const d = createDigest()
    applyEntry(d, assistant([{ id: "q1", name: "AskUserQuestion", input: { questions: [{ question: "どちら？", options: [{ label: "A" }] }] } }]))
    expect(d.pendingAsk).toMatchObject({ question: "どちら？", options: ["A"], count: 1 })
    applyEntry(d, result("q1"))
    expect(d.pendingAsk).toBeNull()
    applyEntry(d, assistant([{ id: "p1", name: "ExitPlanMode", input: { plan: "# 計画\n\n設計を直す" } }]))
    expect(d.pendingPlan?.line).toBe("計画")
    applyEntry(d, { type: "user", message: { content: "新しい依頼" } })
    expect(d.pendingPlan).toBeNull()
    expect(d.pendingTool).toBeNull()
  })

  it("ツールの呼び出しは、ツール名と秘密を伏せた先頭だけを持つ", () => {
    const d = createDigest()
    applyEntry(d, assistant([{ id: "b1", name: "Bash", input: { command: "npm install --token=abcdef0123456789" } }]))
    expect(d.pendingTool).toEqual({ toolUseId: "b1", name: "Bash", preview: `npm install --token=${SECRET_MARK}` })
    applyEntry(d, result("b1"))
    expect(d.pendingTool).toBeNull()
  })
})
