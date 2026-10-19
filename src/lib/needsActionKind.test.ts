import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { afterEach, describe, expect, it } from "vitest"
import { createNotifyTracker } from "./desktopNotifications"
import { makeSessionSummary } from "./desktopFixtures"
import { DesktopSessionService } from "./desktopSessionService"
import { inferStatus, PERMISSION_HINT } from "./desktopSessionStatus"
import type { DesktopMeta } from "./desktopSessions"
import { FlowService } from "./flowService"
import { HousekeepingService } from "./housekeepingService"
import { classifyNeedsAction, kindFromWords, needsActionSourceLabel, type WrapUpDigest } from "./needsActionKind"
import { createDigest, wrapUpDigestOf } from "./transcriptDigest"
import { statusMetaOf } from "@/components/desktopSessions/statusMeta"

const cleanup: string[] = []
afterEach(async () => {
  while (cleanup.length > 0) await fs.rm(cleanup.pop()!, { recursive: true, force: true })
})

describe("言葉の推定（kindFromWords）", () => {
  it.each([
    ["4つの案から決めてください。決まったら commit します", "decision"], // 言葉だけで承認に入っていた外れの例: 「決めて」が commit より先
    ["A案とB案のどちらで進めますか", "decision"],
    ["方針を教えてください", "decision"],
    ["ファイルを書き込む許可をください", "permission"],
    ["権限の確認をお願いします", "permission"],
    ["本番への反映を承認してください", "approval"],
    ["この変更をコミットしてよいですか？", "approval"], // 疑問符より承認の語が先
    ["PR を作ってよいですか", "approval"],
    ["merge してください", "approval"],
    ["次の連絡が来たら実行します", "standby"],
    ["担当の報告が届いたら続けます", "standby"],
    ["ビルドが終わったら再開します", "standby"],
    ["ご確認をお待ちしています", null], // オーナーの操作を待つ言い方は待機にしない
    ["画面の表示を見てください", null],
    ["これで良いでしょうか？", "decision"],
    // 疑問符は待機の語より先(質問が待機に落ちて、要対応から消えないようにする。⑩ ゲート2)
    ["報告が届いたら続けますが、それでよいですか？", "decision"],
    ["次の指示が来たら始めます", "standby"],
    ["準備が出来たらご確認ください", null], // 「出来たら」は待機の「来たら」に当てない
    ["準備が出来たら公開してよいですか", "approval"],
    ["", null],
  ])("%s → %s", (text, kind) => {
    expect(kindFromWords(text)).toBe(kind)
  })

  it("null・undefined は null", () => {
    expect(kindFromWords(null)).toBeNull()
    expect(kindFromWords(undefined)).toBeNull()
  })
})

const wrap = (o: Partial<WrapUpDigest>): WrapUpDigest => ({ askExcerpt: null, askWordKind: null, actions: [], blocked: null, ...o })

describe("分け方の表（classifyNeedsAction）", () => {
  it.each([
    ["ExitPlanMode", { awaitingTool: "ExitPlanMode", wrapUp: null, summaryWordKind: "decision" }, "approval", "plan-tool", false],
    ["AskUserQuestion", { awaitingTool: "AskUserQuestion", wrapUp: null, summaryWordKind: "approval" }, "decision", "ask-tool", false],
    ["wrap_up の質問と commit", { awaitingTool: null, wrapUp: wrap({ askExcerpt: "どちら？", askWordKind: "decision", actions: ["commit"] }), summaryWordKind: "standby" }, "approval", "wrap-up-action", false],
    ["wrap_up の質問と create_pr", { awaitingTool: null, wrapUp: wrap({ askExcerpt: "q", actions: ["create_pr"] }), summaryWordKind: null }, "approval", "wrap-up-action", false],
    ["wrap_up の質問と merge", { awaitingTool: null, wrapUp: wrap({ askExcerpt: "q", actions: ["merge"] }), summaryWordKind: null }, "approval", "wrap-up-action", false],
    ["wrap_up の質問の言葉が承認", { awaitingTool: null, wrapUp: wrap({ askExcerpt: "反映してよい？", askWordKind: "approval" }), summaryWordKind: null }, "approval", "wrap-up-ask", false],
    ["wrap_up の質問（承認以外のボタン）", { awaitingTool: null, wrapUp: wrap({ askExcerpt: "q", askWordKind: "decision", actions: ["verify"] }), summaryWordKind: "approval" }, "decision", "wrap-up-ask", false],
    ["wrap_up に質問が無い（blocked でも）", { awaitingTool: null, wrapUp: wrap({ blocked: true, actions: ["commit"] }), summaryWordKind: "approval" }, "standby", "wrap-up-no-ask", false],
    ["要約の言葉: 許可", { awaitingTool: null, wrapUp: null, summaryWordKind: "permission" }, "permission", "summary-words", true],
    ["要約の言葉: 待機", { awaitingTool: null, wrapUp: null, summaryWordKind: "standby" }, "standby", "summary-words", true],
    ["手がかりなし", { awaitingTool: null, wrapUp: null, summaryWordKind: null }, "unknown", "none", false],
  ] as const)("%s", (_name, input, kind, source, estimated) => {
    expect(classifyNeedsAction(input)).toEqual({ kind, source, estimated })
  })

  it("手がかりの名前", () => {
    expect(needsActionSourceLabel("wrap-up-action", ["commit", "verify"])).toBe("wrap_up のボタン（commit）")
    expect(needsActionSourceLabel("summary-words")).toBe("要約の言葉から推定")
  })
})

describe("wrap_up の入力の取り込み（wrapUpDigestOf）", () => {
  it("ask は先頭60文字だけ。recap・ボタンの文は取り込まず、決まった名前の操作だけを残す", () => {
    const d = wrapUpDigestOf({
      recap: "まとめ MARK-RECAP",
      ask: `${"あ".repeat(70)}コミットしてよいですか`,
      actions: [{ label: "押す MARK-LABEL", message: "送る MARK-MESSAGE" }, { action: "commit" }, { action: "rm -rf" }, "x"],
      blocked: true,
    })
    expect(d.askExcerpt).toBe(`${"あ".repeat(60)}…`)
    // 承認の言葉は、60文字より後ろにあっても推定に使う(文は保持しない)
    expect(d.askWordKind).toBe("approval")
    expect(d.actions).toEqual(["commit"])
    expect(d.blocked).toBe(true)
    expect(JSON.stringify(d)).not.toMatch(/MARK-/)
  })

  it("ask が空・無いときは null。blocked が真偽値でなければ null", () => {
    expect(wrapUpDigestOf({ ask: "  ", blocked: "yes" })).toEqual({ askExcerpt: null, askWordKind: null, actions: [], blocked: null })
  })
})

describe("状態の推定（⑩）", () => {
  const meta = (o: Partial<DesktopMeta>): DesktopMeta => ({
    id: "local_x",
    cliSessionId: null,
    title: "t",
    cwd: null,
    model: null,
    effort: null,
    permissionMode: null,
    isArchived: false,
    isRoutine: false,
    createdAt: null,
    lastActivityAt: 0,
    completedTurns: null,
    statusCategory: "blocked",
    needsAction: true,
    needsActionExcerpt: null,
    summaryWordKind: null,
    summaryFor: null,
    lastAssistantUuid: null,
    hasError: false,
    errorAt: null,
    spawnedFromId: null,
    isSideChat: false,
    ...o,
  })
  const NOW = 10 * 60 * 60_000

  it("wrap_up に質問が無いのに Desktop が要対応にしたものは待機（standby）", () => {
    const digest = createDigest()
    digest.lastWrapUp = wrap({ blocked: false })
    const r = inferStatus({ meta: meta({}), digest, transcriptMtimeMs: 0, now: NOW })
    expect(r.status).toBe("standby")
    expect(r.needsActionInfo).toBeUndefined()
  })

  it("要約の言葉だけで決めたものは推定。状態の根拠に種類と「推定」が出る", () => {
    const r = inferStatus({ meta: meta({ summaryWordKind: "permission" }), digest: null, transcriptMtimeMs: 0, now: NOW })
    expect(r.status).toBe("blocked")
    expect(r.needsActionInfo).toEqual({ kind: "permission", source: "summary-words", estimated: true, buttons: [] })
    expect(r.reason).toContain("許可待ち・推定")
  })

  it("言葉から決めた待機は推定、質問の無い wrap_up で決めた待機は推定でない", () => {
    const byWords = inferStatus({ meta: meta({ summaryWordKind: "standby" }), digest: null, transcriptMtimeMs: 0, now: NOW })
    expect(byWords.status).toBe("standby")
    expect(byWords.standbyInfo).toEqual({ source: "summary-words", estimated: true })
    const digest = createDigest()
    digest.lastWrapUp = wrap({ blocked: false })
    const byWrapUp = inferStatus({ meta: meta({ summaryWordKind: "standby" }), digest, transcriptMtimeMs: 0, now: NOW })
    expect(byWrapUp.standbyInfo).toEqual({ source: "wrap-up-no-ask", estimated: false })
  })

  it("待機のバッジ：推定の待機には「（推定）」を出し、確かな待機には出さない", () => {
    expect(statusMetaOf("standby", null, { source: "summary-words", estimated: true })).toMatchObject({ label: "待機", estimated: true })
    expect(statusMetaOf("standby", null, { source: "wrap-up-no-ask", estimated: false })).toMatchObject({ label: "待機", estimated: false })
    expect(statusMetaOf("standby")).toMatchObject({ label: "待機", estimated: false })
    expect(statusMetaOf("blocked", { kind: "approval", source: "summary-words", estimated: true, buttons: [] })).toMatchObject({ label: "承認待ち", estimated: true })
  })

  it("入力の処理中のまま止まっているものには、許可の確認の一言を付けない", () => {
    const digest = createDigest()
    digest.lastRow = { role: "user", stopReason: null, interrupted: false, at: 0, toolNames: [], resultOf: null }
    digest.lastEventAt = 0
    const r = inferStatus({ meta: meta({ statusCategory: null, needsAction: false }), digest, transcriptMtimeMs: 0, now: NOW })
    expect(r.status).toBe("interrupted")
    expect(r.reason).not.toContain(PERMISSION_HINT)
  })

  it("中断の可能性の根拠に、許可の確認を促す一言が付く", () => {
    const digest = createDigest()
    digest.lastRow = { role: "assistant", stopReason: "tool_use", interrupted: false, at: 0, toolNames: ["Bash"], resultOf: null }
    digest.lastEventAt = 0
    const r = inferStatus({ meta: meta({ statusCategory: null, needsAction: false }), digest, transcriptMtimeMs: 0, now: NOW })
    expect(r.status).toBe("interrupted")
    expect(r.reason).toContain(PERMISSION_HINT)
  })
})

describe("通知（⑩）", () => {
  it("待機は通知しない。待機から要対応になったら通知する", () => {
    const tracker = createNotifyTracker()
    tracker.update([makeSessionSummary("a", { status: "completed" })])
    expect(tracker.update([makeSessionSummary("a", { status: "standby" })])).toHaveLength(0)
    expect(tracker.update([makeSessionSummary("a", { status: "blocked" })])).toHaveLength(1)
  })
})

interface SampleModule {
  makeOrgChartSample: (outDir: string, options?: { now?: number }) => {
    dataDir: string
    projectsRoot: string
    write: () => Promise<void>
    ids: Record<string, string>
    expected: {
      needsAction: {
        kinds: Record<string, [string, string, boolean]>
        standby: string[]
        askExcerpts: Record<string, string>
        decisionCount: number
        marks: string[]
      }
    }
  }
}

async function sample() {
  const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(process.cwd(), "scripts", "make-org-chart-sample.mjs")).href)) as SampleModule
  const now = Date.now()
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-needs-action-test-"))
  cleanup.push(out)
  const s = mod.makeOrgChartSample(path.join(out, "sample"), { now })
  await s.write()
  const sessions = new DesktopSessionService({ dataDir: s.dataDir, projectsRoot: s.projectsRoot, now: () => now })
  return { s, sessions, now }
}

describe("合成データ（⑩）", () => {
  it("N1: 許可待ち・承認待ち・判断待ち・待機が1件以上ずつ出て、種類・手がかり・推定が期待値と一致する", async () => {
    const { s, sessions } = await sample()
    const list = await sessions.list()
    const exp = s.expected.needsAction
    const got: Record<string, [string, string, boolean]> = {}
    for (const x of list.sessions) {
      if (x.status === "blocked" && x.needsActionInfo) got[x.id] = [x.needsActionInfo.kind, x.needsActionInfo.source, x.needsActionInfo.estimated]
    }
    expect(got).toEqual(exp.kinds)
    expect(list.sessions.filter((x) => x.status === "standby").map((x) => x.id).sort()).toEqual(exp.standby)
    // 待機の手がかり: 質問の無い wrap_up は推定でない、要約の言葉は推定
    expect(list.sessions.find((x) => x.id === s.ids.wrapStandby)?.standbyInfo).toEqual({ source: "wrap-up-no-ask", estimated: false })
    expect(list.sessions.find((x) => x.id === s.ids.wordStandby)?.standbyInfo).toEqual({ source: "summary-words", estimated: true })
    for (const kind of ["permission", "approval", "decision"]) expect(Object.values(got).some(([k]) => k === kind), kind).toBe(true)
    expect(exp.standby.length).toBeGreaterThan(0)
  })

  it("要約に要対応の文が無いものは、wrap_up の質問の先頭60文字が出る。待機には要対応の内容を出さない", async () => {
    const { s, sessions } = await sample()
    const list = await sessions.list()
    for (const [id, excerpt] of Object.entries(s.expected.needsAction.askExcerpts)) {
      expect(list.sessions.find((x) => x.id === id)?.needsActionExcerpt).toBe(excerpt)
    }
    for (const id of s.expected.needsAction.standby) {
      expect(list.sessions.find((x) => x.id === id)?.needsActionExcerpt).toBeNull()
    }
  })

  it("N7: status_detail・wrap_up の recap とボタンの文は、一覧・詳細・整理ページのどの応答にも出ない", async () => {
    const { s, sessions, now } = await sample()
    const list = await sessions.list()
    const details = await Promise.all(list.sessions.map((x) => sessions.detail(x.id)))
    const housekeeping = await new HousekeepingService(sessions, new FlowService(sessions, { now: () => now }), {
      now: () => now,
      usage: async () => null,
    }).get()
    const json = JSON.stringify([list, details, housekeeping])
    expect(s.expected.needsAction.marks).toHaveLength(2)
    for (const mark of s.expected.needsAction.marks) expect(json).not.toContain(mark)
  })
})
