import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { afterEach, describe, expect, it } from "vitest"
import { DesktopSessionService } from "./desktopSessionService"
import {
  SENTINEL,
  assistantRow,
  fakeCliId,
  fakeSessionId,
  humanRow,
  makeDesktopFixture,
  makeMeta,
  toJsonl,
  tsAt,
  writeDesktopConfigs,
  writeMeta,
} from "./desktopFixtures"
import { eventKey, selectUnseen, type SeenEvents } from "./flowPlayback"
import { FLOW_SINCE_TOLERANCE_MS, FlowService, normalizeSince, parseFlowParams } from "./flowService"
import { FLOW_DEFAULT_RANGE_MS, FLOW_MAX_RANGE_MS, type FlowEvent, type FlowResponse } from "./flowTypes"
import { readSnapshots } from "./usageSnapshots"

interface SampleModule {
  makeOrgChartSample: (
    outDir: string,
    options?: { now?: number; fiveHourPercent?: number }
  ) => {
    dataDir: string
    projectsRoot: string
    usagePath: string
    write: () => Promise<void>
    groups: { a: string; b: string }
    ids: Record<string, string>
    transcriptPaths: Record<string, string>
    expected: Record<string, Record<string, unknown>>
  }
  appendWorkingHumanInput: (projectsRoot: string, options?: { now?: number }) => Promise<string>
}

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-flow-svc-test-"))
  cleanup.push(dir)
  return dir
}

/** 確認用の合成データ(scripts/make-org-chart-sample.mjs)を作り、組織図のサービスを組み立てる */
async function sampleService(extra: ConstructorParameters<typeof DesktopSessionService>[0] = {}) {
  const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(process.cwd(), "scripts", "make-org-chart-sample.mjs")).href)) as SampleModule
  const now = Date.now()
  const out = await tmpDir()
  const sample = mod.makeOrgChartSample(path.join(out, "sample"), { now })
  await sample.write()
  const sessions = new DesktopSessionService({
    dataDir: sample.dataDir,
    projectsRoot: sample.projectsRoot,
    now: () => now,
    ...extra,
  })
  return { sample, now, mod, sessions, flow: new FlowService(sessions, { now: () => now }) }
}

const ofKind = <K extends FlowEvent["kind"]>(flow: FlowResponse, kind: K) =>
  flow.events.filter((e): e is Extract<FlowEvent, { kind: K }> => e.kind === kind)

describe("normalizeSince", () => {
  const NOW = 1_000_000_000_000
  it("範囲内ならそのまま。数値でない・未来・24時間より前なら、既定（4時間前）", () => {
    const fallback = NOW - FLOW_DEFAULT_RANGE_MS
    expect(normalizeSince(NOW - 60_000, NOW)).toBe(NOW - 60_000)
    expect(normalizeSince(NOW - FLOW_MAX_RANGE_MS, NOW)).toBe(NOW - FLOW_MAX_RANGE_MS)
    expect(normalizeSince(NOW, NOW)).toBe(NOW)
    for (const bad of [
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      NOW + 1,
      NOW - FLOW_MAX_RANGE_MS - FLOW_SINCE_TOLERANCE_MS - 1,
    ]) {
      expect(normalizeSince(bad as number | null, NOW)).toBe(fallback)
    }
  })

  it("画面の「直近24時間」は、通信の時間ぶん24時間を超えて届く。1分以内なら24時間前として扱う（4時間に戻さない）", () => {
    expect(normalizeSince(NOW - FLOW_MAX_RANGE_MS - 1, NOW)).toBe(NOW - FLOW_MAX_RANGE_MS)
    expect(normalizeSince(NOW - FLOW_MAX_RANGE_MS - FLOW_SINCE_TOLERANCE_MS, NOW)).toBe(NOW - FLOW_MAX_RANGE_MS)
  })
})

describe("parseFlowParams", () => {
  const parse = (query: string) => parseFlowParams(new URLSearchParams(query))
  it("group は形式が合うものだけ。since は数値にできなければ null（既定の範囲に直す）", () => {
    expect(parse("group=cg-1&since=1700000000000")).toEqual({ group: "cg-1", since: 1_700_000_000_000 })
    expect(parse("group=cg-1")).toEqual({ group: "cg-1", since: null })
    expect(parse("group=cg-1&since=")).toEqual({ group: "cg-1", since: null })
    expect(Number.isNaN(parse("group=cg-1&since=abc").since)).toBe(true)
    expect(parse("").group).toBeNull()
    expect(parse("group=../x").group).toBeNull()
    expect(parse("group=a%20b").group).toBeNull()
    expect(parse(`group=${"a".repeat(101)}`).group).toBeNull()
  })
})

describe("FlowService: 合成データでの出来事（試験グループ）", () => {
  it("指示・報告・終了・他グループ・圧縮の件数が、合成データの期待値と一致する", async () => {
    const { sample, flow } = await sampleService()
    const result = await flow.build(sample.groups.a)
    expect(result).not.toBeNull()
    const f = result as FlowResponse
    const exp = sample.expected.groupA

    expect(f.group).toEqual({ id: sample.groups.a, name: "試験グループ" })
    expect(f.leaderId).toBe(exp.leader)
    expect(f.prefix).toBe("00_")
    // 指揮役が先頭。ほかは作成日時の古い順（合成データは、作成順と名前順が食い違うように作ってある。名前順の並べ替えは画面側）。
    // 3層目（補助のセッション）と、指揮役が作ったグループ外のセッション（2層目）も、同じ並びに入る
    expect(f.members.map((m) => [m.title, m.isLeader])).toEqual([
      ["00_リーダー_試験", true],
      ["03_検証", false],
      ["01_画面の修正", false],
      ["04_文書の整備", false],
      ["02_集計の作成", false],
      ["補助B_表記ゆれの点検", false],
      ["補助A_さらに下の確認", false],
      ["補助C_件数の再計算", false],
      ["補助D_書式の確認相手", false],
      ["補助_臨時の調べもの", false],
    ])

    // 指示・報告は、3層目の親子（画面の修正 ⇄ 補助B）の分を含む。指揮役自身の分は、その外
    const instructs = ofKind(f, "instruct")
    expect(instructs).toHaveLength(exp.instructs as number)
    expect(instructs.filter((e) => e.receipt === "confirmed")).toHaveLength(exp.confirmed as number)
    expect(instructs.filter((e) => e.receipt === "sender-only")).toHaveLength(exp.senderOnly as number)
    expect(instructs.filter((e) => e.from === exp.leader)).toHaveLength(exp.leaderInstructs as number)
    expect(instructs.filter((e) => e.from !== exp.leader).map((e) => [e.from, e.to])).toEqual([[sample.ids.screen, sample.ids.helperB]])

    const reports = ofKind(f, "report")
    expect(reports).toHaveLength(exp.reports as number)
    expect(reports.filter((e) => e.to === exp.leader)).toHaveLength(exp.leaderReports as number)
    expect(reports.filter((e) => e.to !== exp.leader).map((e) => [e.from, e.to])).toEqual([[sample.ids.helperB, sample.ids.screen]])
    const paired = reports.filter((r) => r.instructAt !== null)
    expect(paired).toHaveLength(exp.pairedReports as number)
    expect(paired.map((r) => r.tools)).toEqual(exp.pairedTools)
    // 組にならない報告は、線は描くが作業量は0
    expect(reports.filter((r) => r.instructAt === null).every((r) => r.tools === 0)).toBe(true)

    const ends = ofKind(f, "end")
    expect(ends.map((e) => e.tools)).toEqual(exp.endTools)

    const cross = ofKind(f, "cross")
    expect(cross.filter((e) => e.source === "other-group")).toHaveLength(exp.crossOtherGroup as number)
    expect(cross.filter((e) => e.source === "external")).toHaveLength(exp.crossExternal as number)
    expect(cross.every((e) => e.to === exp.leader)).toBe(true)

    expect(ofKind(f, "compact")).toHaveLength(exp.compacts as number)
    // 時刻の昇順
    expect(f.events.map((e) => e.t)).toEqual([...f.events.map((e) => e.t)].sort((a, b) => a - b))
  })

  it("指示の要約は先頭20文字。送信側のみの指示は、受信の記録が無い子宛て", async () => {
    const { sample, flow } = await sampleService()
    const f = (await flow.build(sample.groups.a)) as FlowResponse
    const summaries = ofKind(f, "instruct").map((e) => e.summary)
    expect(summaries).toContain("ログイン画面のエラー表示を直してください")
    expect(summaries.every((s) => [...s].length <= 21)).toBe(true) // 20文字＋「…」
    const senderOnly = ofKind(f, "instruct").find((e) => e.receipt === "sender-only")
    expect(senderOnly?.to).toBe(sample.ids.docs)
  })

  it("実データと同じ形（前置きの一文＋タグ＋本文＋末尾の署名）の peer でも、指示・他グループ・外部の要約に、前置き・タグ・署名が残らない", async () => {
    const { sample, flow } = await sampleService()
    const f = (await flow.build(sample.groups.a)) as FlowResponse
    const instructs = ofKind(f, "instruct").filter((e) => e.receipt === "confirmed")
    const cross = ofKind(f, "cross")
    expect(instructs.length).toBeGreaterThanOrEqual(8)
    expect(cross).toHaveLength(2)
    for (const e of [...instructs, ...cross]) {
      expect(e.summary, e.summary).not.toMatch(/Another Claude|cross-session-message|送信元|[<>]/)
      expect(e.summary.length).toBeGreaterThan(0)
    }
    expect(cross.map((e) => e.summary).sort()).toEqual(["ファイル配置の確認依頼です", "共有フォルダの整理をお願いします"])
    expect(JSON.stringify(f)).not.toMatch(/Another Claude|cross-session-message|送信元/)
  })

  it("受け手が作業中に届いた指示（queued_command・origin: peer）も受信の記録になり、送信側のみだった指示が確認済みになる", async () => {
    const { sample, flow } = await sampleService()
    const before = (await flow.build(sample.groups.a)) as FlowResponse
    const pending = ofKind(before, "instruct").find((e) => e.receipt === "sender-only")
    expect(pending?.to).toBe(sample.ids.docs)
    const file = path.join(sample.projectsRoot, "-sample-org-chart", `11111111-1111-4111-8111-${sample.ids.docs.slice(-12)}.jsonl`)
    const arrived = {
      type: "attachment",
      timestamp: new Date((pending?.t ?? 0) + 2_000).toISOString(),
      isSidechain: false,
      attachment: {
        type: "queued_command",
        prompt: `<cross-session-message from="${sample.ids.leaderA}">${pending?.summary}</cross-session-message>`,
        commandMode: "prompt",
        origin: { kind: "peer", from: sample.ids.leaderA, hostInjected: true },
      },
    }
    await fs.appendFile(file, `${JSON.stringify(arrived)}\n`, "utf-8")

    const after = (await flow.build(sample.groups.a)) as FlowResponse
    const count = (f: FlowResponse, receipt: string) => ofKind(f, "instruct").filter((e) => e.receipt === receipt).length
    expect(ofKind(after, "instruct")).toHaveLength(ofKind(before, "instruct").length)
    expect(count(after, "confirmed")).toBe(count(before, "confirmed") + 1)
    expect(count(after, "sender-only")).toBe(count(before, "sender-only") - 1)

    // 画面側の更新: 送信側のみで流した指示が確認済みになっても、粒を2回流さない（同じ指示のキー。印の切り替えだけ）
    const confirmed = ofKind(after, "instruct").find((e) => e.sentAt === pending?.sentAt && e.receipt === "confirmed")
    expect(confirmed?.t).toBe((pending?.t ?? 0) + 2_000)
    expect(confirmed && eventKey(confirmed)).toBe(pending && eventKey(pending))
    const seen: SeenEvents = new Map()
    selectUnseen(before.events, seen)
    const next = selectUnseen(after.events, seen)
    expect(next.fresh.filter((e) => e.kind === "instruct")).toEqual([])
    expect(next.upgraded.map((e) => e.to)).toEqual([sample.ids.docs])
  })

  it("ツール呼び出しのまとまりは数値の組。コンテキストの段階（80%超・90%超）と、作業中の子の最近の呼び出しが含まれる", async () => {
    const { sample, flow } = await sampleService()
    const f = (await flow.build(sample.groups.a)) as FlowResponse
    const indexOf = (id: string) => f.members.findIndex((m) => m.id === id)
    const lastCtx = (id: string) => {
      const samples = f.tools.filter((t) => t[1] === indexOf(id) && t[2] >= 0)
      return samples[samples.length - 1][2]
    }
    const limit = f.members.find((m) => m.id === sample.ids.verify)?.contextLimit as number
    expect(limit).toBe(1_000_000)
    expect(lastCtx(sample.ids.verify) / limit).toBeGreaterThanOrEqual(0.9) // 危険
    expect(lastCtx(sample.ids.docs) / limit).toBeGreaterThanOrEqual(0.8) // 注意
    expect(lastCtx(sample.ids.docs) / limit).toBeLessThan(0.9)
    expect(lastCtx(sample.ids.report) / limit).toBeLessThan(0.8)
    // 作業中の子は、いま(60秒以内)までツールを呼んでいる
    const sinceMs = f.since
    const working = f.tools.filter((t) => t[1] === indexOf(sample.ids.screen))
    const lastAt = sinceMs + working[working.length - 1][0]
    expect(f.generatedAt - lastAt).toBeLessThanOrEqual(60_000)
    // 5秒ごとのまとまり: [経過ms, 添字, コンテキスト, 回数]
    expect(f.tools.every((t) => t.length === 4 && t[0] >= 0 && t[3] >= 1)).toBe(true)
  })

  it("一覧と同じ要約キャッシュを使い、送信上限で止まっている子は一覧の側で確認できる", async () => {
    const { sample, sessions, flow } = await sampleService()
    await flow.build(sample.groups.a)
    await sessions.settle()
    const list = await sessions.list()
    const stopped = list.sessions.find((s) => s.id === sample.ids.verify)
    expect(stopped?.messaging).toMatchObject({ stopped: true, sent: 10 })
  })

  it("止まっている子に、作業中の人の入力（queued_command・origin: human）が追記されると、送信回数が0に戻り、停止が解除される", async () => {
    const { sample, now, mod, sessions } = await sampleService()
    await sessions.settle()
    const before = (await sessions.list()).sessions.find((s) => s.id === sample.ids.verify)
    expect(before?.messaging).toMatchObject({ stopped: true, sent: 10 })

    await mod.appendWorkingHumanInput(sample.projectsRoot, { now: now + 1_000 })
    await sessions.settle()
    const after = (await sessions.list()).sessions.find((s) => s.id === sample.ids.verify)
    expect(after?.messaging).toMatchObject({ stopped: false, sent: 0, undelivered: 0 })
    // ほかの子の送信回数は変わらない
    const others = (await sessions.list()).sessions.filter((s) => s.id !== sample.ids.verify)
    expect(others.some((s) => s.messaging?.stopped)).toBe(false)
  })
})

describe("FlowService: 3層目（子が作った補助のセッション）", () => {
  it("木: 親が指揮役のもの（グループの内外）は2層目、2層目の子が作ったものは、グループの内外を問わず3層目。4層目は2層目の祖先の下", async () => {
    const { sample, flow } = await sampleService()
    const f = (await flow.build(sample.groups.a)) as FlowResponse
    const exp = sample.expected.groupA
    const tree = Object.fromEntries(f.members.filter((m) => !m.isLeader).map((m) => [m.id, m.parentId]))
    // 期待値: セッション → [層, 親]。4層目（補助A。補助B が作った）は、2層目の祖先（画面の修正）の下
    const expected = exp.tree as Record<string, [number, string]>
    expect(tree).toEqual(Object.fromEntries(Object.entries(expected).map(([id, [, parent]]) => [id, parent])))
    expect(f.members.find((m) => m.isLeader)?.parentId).toBeNull()
    // 層は、親から決まる（指揮役の子=2、それ以外の親=3）
    for (const [id, [depth, parent]] of Object.entries(expected)) {
      const m = f.members.find((x) => x.id === id)
      expect(m, id).toBeDefined()
      expect(m?.parentId).toBe(parent)
      expect(parent === exp.leader ? 2 : 3).toBe(depth)
    }
  })

  it("木に出ないもの: 親が見つからないグループ外のセッション・アーカイブ済み・別グループ", async () => {
    const { sample, flow } = await sampleService()
    const f = (await flow.build(sample.groups.a)) as FlowResponse
    const ids = new Set(f.members.map((m) => m.id))
    for (const id of sample.expected.groupA.notInTree as string[]) expect(ids.has(id), id).toBe(false)
    expect(ids.has(sample.ids.sideB)).toBe(false) // 別グループの3層目は、別グループの組織図にだけ出る
    expect(JSON.stringify(f)).not.toContain(sample.ids.stray)
  })

  it("サイドチャットはカードにせず、親のカードに数だけ出す。同じ親の作業用の子（sideSession だけ）はカードになる", async () => {
    const { sample, flow, sessions } = await sampleService()
    const f = (await flow.build(sample.groups.a)) as FlowResponse
    const ids = new Set(f.members.map((m) => m.id))
    expect(ids.has(sample.ids.sideChat)).toBe(false)
    expect(ids.has(sample.ids.helperB)).toBe(true) // 作業用の子（画面の修正が作った）
    const counts = Object.fromEntries(f.members.filter((m) => m.sideChats > 0).map((m) => [m.id, m.sideChats]))
    expect(counts).toEqual(Object.fromEntries(sample.expected.groupA.sideChats as Array<[string, number]>))
    // サイドチャットの出来事も流れない
    expect(JSON.stringify(f.events)).not.toContain(sample.ids.sideChat)
    // 一覧には、サイドチャットの印つきで出る（作業用の子には付かない）
    const list = await sessions.list()
    const byId = new Map(list.sessions.map((s) => [s.id, s] as const))
    expect(byId.get(sample.ids.sideChat)).toMatchObject({ isSideChat: true, spawnedFromId: sample.ids.screen })
    expect(byId.get(sample.ids.helperB)?.isSideChat).toBe(false)
  })

  it("3層目の親子の間の指示・報告は、2層目と同じ規則（受信確認・組・作業量）で出る。3層目から指揮役への連絡は、他グループ扱いにならない", async () => {
    const { sample, flow } = await sampleService()
    const f = (await flow.build(sample.groups.a)) as FlowResponse
    const toHelper = ofKind(f, "instruct").filter((e) => e.to === sample.ids.helperB)
    expect(toHelper).toHaveLength(1)
    expect(toHelper[0]).toMatchObject({ from: sample.ids.screen, receipt: "confirmed", summary: "表記ゆれがないか見てください" })
    const fromHelper = ofKind(f, "report").filter((e) => e.from === sample.ids.helperB)
    expect(fromHelper).toHaveLength(1)
    expect(fromHelper[0]).toMatchObject({ to: sample.ids.screen, instructAt: toHelper[0].t })
    // 作業6回 ＋ 報告の送信1回
    expect(fromHelper[0].tools).toBe(7)
    // 他グループの連絡は1件のまま（3層目の送信は含まない）
    expect(ofKind(f, "cross").filter((e) => e.source === "other-group")).toHaveLength(sample.expected.groupA.crossOtherGroup as number)
  })

  it("3層目の peer が無くても、ツール呼び出しがあれば作業量のまとまりが出る。コンテキストの上限も持つ", async () => {
    const { sample, flow } = await sampleService()
    const f = (await flow.build(sample.groups.a)) as FlowResponse
    const index = f.members.findIndex((m) => m.id === sample.ids.practiceD)
    expect(index).toBeGreaterThan(0)
    const mine = f.tools.filter((x) => x[1] === index)
    expect(mine.length).toBeGreaterThan(0)
    // いまの60秒以内までツールを呼んでいる（作業中になる）
    const last = f.since + mine[mine.length - 1][0]
    expect(f.generatedAt - last).toBeLessThanOrEqual(60_000)
    expect(f.members[index].contextLimit).toBe(1_000_000)
    // この子には、指示も報告も無い
    expect(f.events.some((e) => ("to" in e && e.to === sample.ids.practiceD) || ("from" in e && e.from === sample.ids.practiceD))).toBe(false)
  })

  it("3層目の会話ログも差分読み: 変わっていないファイルは読み直さず、追記された分だけを読む", async () => {
    const { sample, now, flow } = await sampleService()
    await flow.build(sample.groups.a)
    const first = flow.reader.bytesRead
    expect(first).toBeGreaterThan(0)
    await flow.build(sample.groups.a)
    expect(flow.reader.bytesRead).toBe(first)

    const file = path.join(sample.projectsRoot, "-sample-org-chart", `11111111-1111-4111-8111-${sample.ids.helperB.slice(-12)}.jsonl`)
    const appended = toJsonl([assistantRow({ ts: new Date(now - 1000).toISOString(), stop: "tool_use", tools: [{ name: "Bash", input: {}, id: "toolu_sub_new" }] })])
    await fs.appendFile(file, appended)
    await flow.build(sample.groups.a)
    expect(flow.reader.bytesRead - first).toBe(Buffer.byteLength(appended))
  })

  it("3層目のライブ: 親の会話ログに、3層目からの連絡を追記すると、報告として出る（指示と組にならない報告も、線は描く）", async () => {
    const { sample, now, flow } = await sampleService()
    const before = (await flow.build(sample.groups.a)) as FlowResponse
    // 文書の整備（補助Dの親）の会話ログに、補助D（やりとりが無かった3層目）からの連絡を追記する
    const file = path.join(sample.projectsRoot, "-sample-org-chart", `11111111-1111-4111-8111-${sample.ids.docs.slice(-12)}.jsonl`)
    const row = {
      type: "user",
      timestamp: new Date(now - 2_000).toISOString(),
      isSidechain: false,
      isMeta: true,
      origin: { kind: "peer", from: sample.ids.practiceD, hostInjected: true },
      message: { role: "user", content: "補足の連絡です" },
    }
    await fs.appendFile(file, `${JSON.stringify(row)}\n`, "utf-8")
    const after = (await flow.build(sample.groups.a)) as FlowResponse
    const reportsOf = (f: FlowResponse) => ofKind(f, "report").filter((e) => e.from === sample.ids.practiceD)
    expect(reportsOf(before)).toHaveLength(0)
    const added = reportsOf(after)
    expect(added).toHaveLength(1)
    // 指示と組にならない報告も、線は描く（作業量0）
    expect(added[0]).toMatchObject({ to: sample.ids.docs, instructAt: null, tools: 0 })
  })

  it("API の応答に、spawnedFrom のほかの項目（taskId・title・name）の値が含まれない（許可リスト）", async () => {
    const root = await tmpDir()
    const fx = await makeDesktopFixture(root)
    await writeDesktopConfigs(fx, {
      groups: [{ id: "cg-1", name: "試験", order: 1 }],
      assignments: { [fakeSessionId(1)]: "cg-1", [fakeSessionId(2)]: "cg-1" },
    })
    await writeMeta(fx, makeMeta({ n: 1, title: "00_リーダー", createdAt: 1_000 }))
    await writeMeta(fx, makeMeta({ n: 2, title: "01_子", createdAt: 2_000 }))
    await writeMeta(fx, makeMeta({ n: 3, title: "補助", createdAt: 3_000, spawnedFromId: fakeSessionId(2) }))
    const dir = path.join(fx.projectsRoot, "-sample")
    await fs.mkdir(dir, { recursive: true })
    for (const n of [1, 2, 3]) {
      await fs.writeFile(path.join(dir, `${fakeCliId(n)}.jsonl`), toJsonl([humanRow("指示", { ts: tsAt(1) }), assistantRow({ ts: tsAt(2) })]))
    }
    const sessions = new DesktopSessionService({ dataDir: fx.dataDir, projectsRoot: fx.projectsRoot })
    const f = await new FlowService(sessions).build("cg-1")
    expect(f?.members.map((m) => [m.id, m.parentId])).toEqual([
      [fakeSessionId(1), null],
      [fakeSessionId(2), fakeSessionId(1)],
      [fakeSessionId(3), fakeSessionId(2)],
    ])
    expect(JSON.stringify(f)).not.toContain(SENTINEL)
  })
})

describe("合成データの利用上限の記録", () => {
  it("公式値の記録を2件作る。最後の5時間は既定で22%、上限ガードの確認用には92%にできる", async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(process.cwd(), "scripts", "make-org-chart-sample.mjs")).href)) as SampleModule
    const now = Date.now()
    for (const [options, expected] of [
      [{ now }, 22],
      [{ now, fiveHourPercent: 92 }, 92],
    ] as const) {
      const sample = mod.makeOrgChartSample(path.join(await tmpDir(), "sample"), options)
      await sample.write()
      const result = await readSnapshots(sample.usagePath)
      expect(result.found).toBe(true)
      expect(result.snapshots).toHaveLength(2)
      const last = result.snapshots[result.snapshots.length - 1]
      expect(last.plan).toBe("Max")
      expect(last.windows.find((w) => w.key === "five_hour")?.percentUsed).toBe(expected)
      expect(last.windows.find((w) => w.key === "weekly_all")?.percentUsed).toBe(14)
      expect(last.ts).toBeLessThanOrEqual(now)
    }
  })
})

describe("FlowService: 別グループ・指揮役の判定・範囲", () => {
  it("別グループ（指揮役1・子1）は、自分のグループの出来事だけを返す", async () => {
    const { sample, flow } = await sampleService()
    const f = (await flow.build(sample.groups.b)) as FlowResponse
    const exp = sample.expected.groupB
    expect(f.leaderId).toBe(exp.leader)
    expect(ofKind(f, "instruct")).toHaveLength(exp.instructs as number)
    expect(ofKind(f, "report")).toHaveLength(exp.reports as number)
    expect(ofKind(f, "cross")).toEqual([])
    // 別グループの木: 指揮役・子・子が作ったグループ外のセッション（3層目）。試験グループのセッションは混ざらない
    expect(f.members.map((m) => m.title)).toEqual(["00_リーダー_別", "01_調査", "補助_別グループの下調べ"])
    expect(Object.fromEntries(f.members.filter((m) => !m.isLeader).map((m) => [m.id, m.parentId]))).toEqual({
      [sample.ids.research]: sample.ids.leaderB,
      [sample.ids.sideB]: sample.ids.research,
    })
  })

  it("存在しないグループは null", async () => {
    const { flow } = await sampleService()
    expect(await flow.build("cg-none")).toBeNull()
  })

  it("接頭辞は設定で変えられる。一致しなければ指揮役がいなくなり、指示・報告の出来事は出ない", async () => {
    const other = await sampleService({ orchestratorPrefix: "01_" })
    const f1 = (await other.flow.build(other.sample.groups.a)) as FlowResponse
    expect(f1.prefix).toBe("01_")
    expect(f1.leaderId).toBe(other.sample.ids.screen) // 「01_」で始まるのは1件だけ

    const none = await sampleService({ orchestratorPrefix: "99_" })
    const f2 = (await none.flow.build(none.sample.groups.a)) as FlowResponse
    expect(f2.leaderId).toBeNull()
    expect(f2.members.every((m) => !m.isLeader)).toBe(true)
    expect(f2.events.filter((e) => e.kind !== "compact")).toEqual([])
    // 指揮役がいなければ、木は作らない: グループ内のセッション（6件）だけを、親なしで並べる。グループ外のセッションは出さない
    expect(f2.members).toHaveLength(6)
    expect(f2.members.every((m) => m.parentId === null)).toBe(true)
    expect(f2.members.some((m) => m.id === none.sample.ids.helperB || m.id === none.sample.ids.adhoc)).toBe(false)
  })

  it("範囲を狭めると、その範囲の出来事だけになる。範囲より前の指示と組になる報告は残る", async () => {
    const { sample, now, flow } = await sampleService()
    const full = (await flow.build(sample.groups.a)) as FlowResponse
    const narrow = (await flow.build(sample.groups.a, now - 100 * 60_000)) as FlowResponse
    expect(narrow.since).toBe(now - 100 * 60_000)
    expect(narrow.events.every((e) => e.t >= narrow.since)).toBe(true)
    expect(narrow.events.length).toBeLessThan(full.events.length)
    // 指示が範囲より前（ago 120）で、報告・終了が範囲内のもの
    const end = ofKind(narrow, "end").find((e) => e.instructAt < narrow.since)
    expect(end).toBeUndefined() // 120分前の終了は110分前なので、範囲外
    const bad = (await flow.build(sample.groups.a, now + 60_000)) as FlowResponse
    expect(bad.since).toBe(now - FLOW_DEFAULT_RANGE_MS)
  })

  it("応答に、報告・指示の本文（20文字より後ろ）・目印の文字列が含まれない（許可リスト）", async () => {
    const { sample, now, flow } = await sampleService()
    // 子の指示と指揮役への報告の本文に、20文字より後ろに目印を足した行を追記する
    // 指揮役の会話ログは、⑨ の合成データから自分のフォルダにある(記憶が会話ログのフォルダごとのため)
    const fileOf = (id: string) => sample.transcriptPaths[id]
    const row = (toId: string, fromId: string, text: string) => ({
      type: "user",
      timestamp: new Date(now - 5_000).toISOString(),
      isSidechain: false,
      isMeta: true,
      origin: { kind: "peer", from: fromId, hostInjected: true },
      message: { role: "user", content: text },
    })
    await fs.appendFile(fileOf(sample.ids.report), JSON.stringify(row(sample.ids.report, sample.ids.leaderA, `${"あ".repeat(20)}${SENTINEL}`)) + "\n")
    await fs.appendFile(fileOf(sample.ids.leaderA), JSON.stringify(row(sample.ids.leaderA, sample.ids.report, `報告の本文です。${SENTINEL}`)) + "\n")
    await fs.appendFile(fileOf(sample.ids.leaderA), JSON.stringify(row(sample.ids.leaderA, sample.ids.leaderB, `${"い".repeat(20)}${SENTINEL}`)) + "\n")
    const f = (await flow.build(sample.groups.a)) as FlowResponse
    const json = JSON.stringify(f)
    expect(json).not.toContain(SENTINEL)
    expect(json).not.toContain("報告の本文です")
    // 追記した指示と他グループ連絡は、先頭20文字で出る
    expect(json).toContain(`${"あ".repeat(20)}…`)
    expect(json).toContain(`${"い".repeat(20)}…`)
    // 完了しました などの報告の本文は、どの出来事にも含まれない
    expect(json).not.toContain("完了しました")
    expect(json).not.toContain("合成の報告")
  })

  it("応答にDesktopのメタデータの値（システムプロンプトの写し・MCP設定・認証情報）が含まれない", async () => {
    const root = await tmpDir()
    const fx = await makeDesktopFixture(root)
    await writeDesktopConfigs(fx, {
      groups: [{ id: "cg-1", name: "試験", order: 1 }],
      assignments: { [fakeSessionId(1)]: "cg-1" },
    })
    await writeMeta(fx, makeMeta({ n: 1, title: "00_リーダー" }))
    const dir = path.join(fx.projectsRoot, "-sample")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${fakeCliId(1)}.jsonl`), toJsonl([humanRow("指示", { ts: tsAt(1) }), assistantRow({ ts: tsAt(2) })]))
    const sessions = new DesktopSessionService({ dataDir: fx.dataDir, projectsRoot: fx.projectsRoot })
    const f = await new FlowService(sessions).build("cg-1")
    expect(f?.leaderId).toBe(fakeSessionId(1))
    expect(JSON.stringify(f)).not.toContain(SENTINEL)
  })
})

describe("FlowService: 大きさ・速さ・差分読み", () => {
  /** 子10件、ツール呼び出し2万回（4時間に均等）の、合成のグループ */
  async function heavyService() {
    const root = await tmpDir()
    const fx = await makeDesktopFixture(root)
    const now = Date.now()
    const ids = Array.from({ length: 11 }, (_, i) => i + 1)
    await writeDesktopConfigs(fx, {
      groups: [{ id: "cg-heavy", name: "大きなグループ", order: 1 }],
      assignments: Object.fromEntries(ids.map((n) => [fakeSessionId(n), "cg-heavy"])),
    })
    const dir = path.join(fx.projectsRoot, "-sample-heavy")
    await fs.mkdir(dir, { recursive: true })
    for (const n of ids) {
      await writeMeta(fx, makeMeta({ n, title: n === 1 ? "00_リーダー" : `${String(n).padStart(2, "0")}_子`, createdAt: now - (100 - n) * 60_000 }))
      const rows: unknown[] = []
      if (n > 1) {
        for (let i = 0; i < 2000; i++) {
          const ts = new Date(now - 4 * 3600_000 + ((i + 1) * 4 * 3600_000) / 2002).toISOString()
          rows.push(assistantRow({ ts, stop: "tool_use", cacheRead: 100_000 + i * 10, tools: [{ name: "Bash", input: {}, id: `toolu_${n}_${i}` }] }))
        }
      }
      await fs.writeFile(path.join(dir, `${fakeCliId(n)}.jsonl`), toJsonl(rows))
    }
    const sessions = new DesktopSessionService({ dataDir: fx.dataDir, projectsRoot: fx.projectsRoot, now: () => now })
    return { now, dir, sessions, flow: new FlowService(sessions, { now: () => now }) }
  }

  it("子10件・ツール呼び出し2万回で、応答が1MB以内。初回は1.5秒以内、2回目以降は0.3秒以内", async () => {
    const { flow } = await heavyService()
    const t0 = performance.now()
    const first = (await flow.build("cg-heavy")) as FlowResponse
    const firstMs = performance.now() - t0
    const size = Buffer.byteLength(JSON.stringify(first))
    expect(first.members).toHaveLength(11)
    expect(first.tools.length).toBeGreaterThan(10_000)
    expect(size, `応答 ${size} バイト`).toBeLessThan(1024 * 1024)
    expect(firstMs, `初回 ${Math.round(firstMs)}ms`).toBeLessThan(1500)

    const t1 = performance.now()
    await flow.build("cg-heavy")
    const secondMs = performance.now() - t1
    expect(secondMs, `2回目 ${Math.round(secondMs)}ms`).toBeLessThan(300)
  })

  it("2回目以降は、変わっていないファイルを読み直さない。追記された分だけを読む", async () => {
    const { flow, dir, now } = await heavyService()
    await flow.build("cg-heavy")
    const afterFirst = flow.reader.bytesRead
    expect(afterFirst).toBeGreaterThan(0)
    await flow.build("cg-heavy")
    expect(flow.reader.bytesRead).toBe(afterFirst)

    const appended = toJsonl([assistantRow({ ts: new Date(now - 1000).toISOString(), stop: "tool_use", tools: [{ name: "Bash", input: {}, id: "toolu_new" }] })])
    await fs.appendFile(path.join(dir, `${fakeCliId(2)}.jsonl`), appended)
    await flow.build("cg-heavy")
    expect(flow.reader.bytesRead - afterFirst).toBe(Buffer.byteLength(appended))
  })
})
