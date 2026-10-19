import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DesktopSessionService } from "./desktopSessionService"
import {
  NEEDS_ACTION_HEAD,
  SENTINEL,
  SYNTHETIC_SEND_LIMIT,
  SYNTHETIC_SEND_OK,
  SYNTHETIC_SEND_UNREACHABLE,
  assistantRow,
  compactRow,
  fakeCliId,
  fakeSessionId,
  fakeUuid,
  humanRow,
  makeDesktopFixture,
  makeMeta,
  planRow,
  sendResultRow,
  sendRow,
  toolResultRow,
  touch,
  tsAt,
  writeDesktopConfigs,
  writeMeta,
  writeTranscript,
  type DesktopFixture,
} from "./desktopFixtures"

const cleanup: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

const NOW = Date.UTC(2026, 0, 2, 0, 0, 0)

async function fixture(): Promise<DesktopFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-desktop-svc-test-"))
  cleanup.push(root)
  return makeDesktopFixture(root)
}

function service(fx: DesktopFixture, extra: Partial<ConstructorParameters<typeof DesktopSessionService>[0]> = {}) {
  return new DesktopSessionService({ dataDir: fx.dataDir, projectsRoot: fx.projectsRoot, now: () => NOW, tailBytes: 2048, ...extra })
}

/** 状態の異なる6セッションを作る */
async function seed(fx: DesktopFixture) {
  // 1: 実行中(ツール結果待ちで更新が新しい)
  await writeMeta(fx, makeMeta({ n: 1, title: "実行中の作業", category: "completed", summaryFor: "old", model: "claude-opus-5-5", effort: "high" }))
  const t1 = await writeTranscript(fx, fakeCliId(1), [
    humanRow("実行中の指示", { ts: tsAt(1) }),
    assistantRow({ stop: "tool_use", uuid: fakeUuid(101), ts: tsAt(2), input: 100, cacheRead: 10_000 }),
  ])
  await touch(t1, NOW, 20)

  // 2: 要対応(ターン完了・要約が最後の応答に対応)。圧縮・タスクリスト・グループ・ピン留め・コンテキスト500K
  await writeMeta(fx, makeMeta({ n: 2, title: "要対応の作業", category: "blocked", summaryFor: fakeUuid(201), lastAssistantUuid: fakeUuid(201) }))
  const padding = Array.from({ length: 80 }, (_, i) => assistantRow({ stop: "tool_use", text: "x".repeat(100), ts: tsAt(10 + i) }))
  const t2 = await writeTranscript(fx, fakeCliId(2), [
    humanRow("最初の指示", { ts: tsAt(1) }),
    compactRow(tsAt(2)),
    planRow(
      {
        items: [
          { content: "調査", status: "completed" },
          { content: "実装を進める", status: "in_progress" },
          { content: "検証", status: "pending" },
        ],
        scope: "first_task",
      },
      { ts: tsAt(3) }
    ),
    ...padding,
    humanRow("人の最新の指示", { ts: tsAt(200) }),
    humanRow("<cross-session-message>他セッションからの連絡", { ts: tsAt(201), origin: { kind: "peer", from: "local_other" } }),
    assistantRow({ stop: "end_turn", uuid: fakeUuid(201), ts: tsAt(202), input: 50, cacheRead: 499_950 }),
  ])
  await touch(t2, NOW, 3600)

  // 3: 確認待ち
  await writeMeta(fx, makeMeta({ n: 3, title: "確認待ちの作業", category: "review_ready", summaryFor: fakeUuid(301) }))
  const t3 = await writeTranscript(fx, fakeCliId(3), [humanRow("確認の指示"), assistantRow({ stop: "end_turn", uuid: fakeUuid(301) })])
  await touch(t3, NOW, 7200)

  // 4: 完了・アーカイブ済み
  await writeMeta(fx, makeMeta({ n: 4, title: "完了済み", category: "completed", summaryFor: fakeUuid(401), isArchived: true }))
  const t4 = await writeTranscript(fx, fakeCliId(4), [humanRow("完了した指示"), assistantRow({ stop: "end_turn", uuid: fakeUuid(401) })])
  await touch(t4, NOW, 86_400)

  // 5: 中断の可能性
  await writeMeta(fx, makeMeta({ n: 5, title: "中断した作業", category: "completed", summaryFor: "old" }))
  const t5 = await writeTranscript(fx, fakeCliId(5), [humanRow("中断した指示"), assistantRow({ stop: "tool_use", uuid: fakeUuid(501) }), toolResultRow()])
  await touch(t5, NOW, 7200)

  // 6: 会話ログが見つからない
  await writeMeta(fx, makeMeta({ n: 6, title: "ログ無し", category: "review_ready" }))

  await writeDesktopConfigs(fx, {
    groups: [
      { id: "cg-design", name: "設計", order: 1 },
      { id: "cg-empty", name: "空のグループ", order: 2 },
    ],
    assignments: { [`code:${fakeSessionId(2)}`]: "cg-design" },
    starred: [fakeSessionId(2)],
  })
  return { t1, t2 }
}

describe("DesktopSessionService.list", () => {
  it("Desktopのメタデータを主データに、状態・モデル・グループ・コンテキスト・フェーズ・最新の指示を組み立てる", async () => {
    const fx = await fixture()
    await seed(fx)
    const svc = service(fx)
    const list = await svc.list()
    await svc.settle()
    const full = await svc.list()

    expect(list.source).toBe("desktop")
    const byTitle = (title: string) => full.sessions.find((s) => s.title === title)!

    const running = byTitle("実行中の作業")
    expect(running).toMatchObject({ status: "running", model: "claude-opus-5-5", effort: "high", folderName: "project-1" })
    expect(running.statusReason).toContain("推定")

    const blocked = byTitle("要対応の作業")
    expect(blocked).toMatchObject({ status: "blocked", needsAction: true, pinned: true, group: { id: "cg-design", name: "設計" } })
    expect(blocked.context).toMatchObject({ tokens: 500_000, limit: 1_000_000, ratio: 0.5 })
    expect(blocked.phase).toEqual({ completed: 1, total: 3, currentStep: "実装を進める" })
    expect(blocked.compactionCount).toBe(1)
    // 人の指示を優先して表示し、その後に他セッションからの入力があったことが分かる
    expect(blocked.latestInstruction).toMatchObject({ excerpt: "人の最新の指示", origin: "human" })
    expect(blocked.latestInputOrigin).toBe("peer")
    expect(blocked.digest).toBe("full")

    expect(byTitle("確認待ちの作業").status).toBe("review_ready")
    expect(byTitle("完了済み")).toMatchObject({ status: "completed", isArchived: true })
    expect(byTitle("中断した作業").status).toBe("interrupted")
    expect(byTitle("ログ無し")).toMatchObject({ transcript: "missing", status: "review_ready", digest: "none", context: null })
  })

  it("要対応のセッションにだけ、要対応の内容の先頭60文字を付ける(状態の説明・ターンのまとめ・60文字より後は出さない)", async () => {
    const fx = await fixture()
    await seed(fx)
    const svc = service(fx)
    await svc.list()
    await svc.settle()
    const list = await svc.list()
    const blocked = list.sessions.find((x) => x.title === "要対応の作業")!
    expect(blocked.needsActionExcerpt?.startsWith(NEEDS_ACTION_HEAD)).toBe(true)
    expect(blocked.needsActionExcerpt?.replace("…", "").length).toBe(60)
    expect(list.sessions.filter((x) => x.needsActionExcerpt !== null)).toHaveLength(1)
    const detail = await svc.detail(fakeSessionId(2))
    expect(detail?.needsActionExcerpt).toBe(blocked.needsActionExcerpt)
    expect(JSON.stringify([list, detail])).not.toContain(SENTINEL)
  })

  it("回答待ちで要対応になったセッションには、前のターンの要約文を出さない", async () => {
    const fx = await fixture()
    await writeMeta(fx, makeMeta({ n: 1, title: "質問中", category: "blocked", summaryFor: "old" }))
    const t = await writeTranscript(fx, fakeCliId(1), [
      humanRow("依頼", { ts: new Date(NOW - 7200_000).toISOString() }),
      assistantRow({ stop: "tool_use", ts: new Date(NOW - 7190_000).toISOString(), tools: [{ name: "AskUserQuestion", input: {}, id: "toolu_q" }] }),
    ])
    await touch(t, NOW, 7190)
    const s = (await service(fx).list()).sessions[0]
    expect(s.status).toBe("blocked")
    expect(s.needsActionExcerpt).toBeNull()
  })

  it("集計: アーカイブ済みは数に含めず、要対応と実行中を上に並べる", async () => {
    const fx = await fixture()
    await seed(fx)
    const svc = service(fx)
    await svc.list()
    await svc.settle()
    const list = await svc.list()

    expect(list.counts).toEqual({ total: 5, running: 1, blocked: 1, reviewReady: 2, highContext: 0, archived: 1 })
    expect(list.sessions.slice(0, 2).map((s) => s.status)).toEqual(["blocked", "running"])
    expect(list.groups).toEqual([
      { id: "cg-design", name: "設計", order: 1, count: 1 },
      { id: "cg-empty", name: "空のグループ", order: 2, count: 0 },
    ])
    expect(list.contextLimitNote).toContain("仮置き")
  })

  it("最初の応答は末尾だけの暫定値(圧縮の回数・フェーズは未確定)で返し、解析後に確定する", async () => {
    const fx = await fixture()
    await seed(fx)
    const svc = service(fx)

    const first = await svc.list()
    const partial = first.sessions.find((s) => s.title === "要対応の作業")!
    expect(partial.digest).toBe("partial")
    expect(partial.compactionCount).toBeNull()
    expect(partial.phase).toBeNull()
    expect(partial.latestInstruction?.excerpt).toBe("人の最新の指示")
    expect(partial.context?.tokens).toBe(500_000)
    expect(first.warnings.some((w) => w.includes("全体解析中"))).toBe(true)

    await svc.settle()
    const second = await svc.list()
    const done = second.sessions.find((s) => s.title === "要対応の作業")!
    expect(done.digest).toBe("full")
    expect(done.compactionCount).toBe(1)
    expect(done.phase?.total).toBe(3)
    expect(second.warnings.some((w) => w.includes("全体解析中"))).toBe(false)
  })

  it("返してはいけない項目(システムプロンプトの写し・MCP設定・要約文・トークン)が、一覧にも詳細にも現れない(S1〜S3)", async () => {
    const fx = await fixture()
    await seed(fx)
    const svc = service(fx)
    await svc.list()
    await svc.settle()
    const list = await svc.list()
    const detail = await svc.detail(fakeSessionId(2))

    expect(JSON.stringify(list)).not.toContain(SENTINEL)
    expect(JSON.stringify(detail)).not.toContain(SENTINEL)
    expect(JSON.stringify(list.sessions[0])).not.toMatch(/promptAppendSnapshot|enabledMcpTools|remoteMcpServersConfig|toolSurfaceSnapshot|sessionPermissionUpdates/)
  })

  it("親(spawnedFrom.sessionId)を一覧の要約に出す。spawnedFrom のほかの項目は出ない。組織図の3層目の候補（グループ外・親あり・アーカイブでない）を返す", async () => {
    const fx = await fixture()
    await writeMeta(fx, makeMeta({ n: 1, title: "指揮役" }))
    await writeMeta(fx, makeMeta({ n: 2, title: "グループ外の子", createdAt: 2_000, spawnedFromId: fakeSessionId(1) }))
    await writeMeta(fx, makeMeta({ n: 3, title: "親が見つからない", createdAt: 1_000, spawnedFromId: fakeSessionId(99) }))
    await writeMeta(fx, makeMeta({ n: 4, title: "アーカイブ済み", spawnedFromId: fakeSessionId(1), isArchived: true }))
    await writeMeta(fx, makeMeta({ n: 5, title: "親なし" }))
    await writeMeta(fx, makeMeta({ n: 6, title: "別グループの子", spawnedFromId: fakeSessionId(1) }))
    await writeMeta(fx, makeMeta({ n: 7, title: "形が違う親", spawnedFromId: "not-a-session" }))
    await writeDesktopConfigs(fx, {
      groups: [
        { id: "cg-a", name: "A", order: 1 },
        { id: "cg-b", name: "B", order: 2 },
      ],
      assignments: { [`code:${fakeSessionId(1)}`]: "cg-a", [`code:${fakeSessionId(6)}`]: "cg-b" },
    })
    const svc = service(fx)
    const list = await svc.list()
    const byTitle = (title: string) => list.sessions.find((s) => s.title === title)!
    expect(byTitle("グループ外の子").spawnedFromId).toBe(fakeSessionId(1))
    expect(byTitle("指揮役").spawnedFromId).toBeNull()
    expect(byTitle("形が違う親").spawnedFromId).toBeNull()
    expect(JSON.stringify(list)).not.toContain(SENTINEL)

    const { sources, outsiders } = await svc.groupSources("cg-a")
    expect(sources.map((s) => s.summary.title)).toEqual(["指揮役"])
    // 古い順。アーカイブ済み・親が無い・別グループ・形が違う親は含めない
    expect(outsiders.map((s) => s.summary.title)).toEqual(["親が見つからない", "グループ外の子"])
  })

  it("読み取り専用で、config.json は開かず、書き込みもしない(S1・S5)", async () => {
    const fx = await fixture()
    await seed(fx)
    const readSpy = vi.spyOn(fs, "readFile")
    const openSpy = vi.spyOn(fs, "open")
    const writeSpy = vi.spyOn(fs, "writeFile")
    const renameSpy = vi.spyOn(fs, "rename")
    const rmSpy = vi.spyOn(fs, "rm")
    const svc = service(fx)
    await svc.list()
    await svc.settle()
    await svc.list()

    const touched = [...readSpy.mock.calls, ...openSpy.mock.calls].map((c) => path.basename(String(c[0])))
    expect(touched.length).toBeGreaterThan(0)
    expect(touched).not.toContain("config.json")
    expect(writeSpy).not.toHaveBeenCalled()
    expect(renameSpy).not.toHaveBeenCalled()
    expect(rmSpy).not.toHaveBeenCalled()
    // open は読み取りモードのみ
    expect(openSpy.mock.calls.every((c) => c[1] === "r")).toBe(true)
  })

  it("変わっていないファイルは再取得で読み直さない(更新時刻キャッシュ)", async () => {
    const fx = await fixture()
    await seed(fx)
    const svc = service(fx)
    await svc.list()
    await svc.settle()
    await svc.list()

    const readSpy = vi.spyOn(fs, "readFile")
    const openSpy = vi.spyOn(fs, "open")
    await svc.list()
    expect(readSpy).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it("会話ログへの追記は差分だけ読み足し、サイズが減ったら最初から読み直す", async () => {
    const fx = await fixture()
    const { t1 } = await seed(fx)
    const svc = service(fx)
    await svc.list()
    await svc.settle()

    await fs.appendFile(t1, JSON.stringify(humanRow("追記された指示", { ts: tsAt(500) })) + "\n")
    const appended = await svc.list()
    expect(appended.sessions.find((s) => s.title === "実行中の作業")!.latestInstruction?.excerpt).toBe("追記された指示")

    await fs.writeFile(t1, JSON.stringify(humanRow("書き直し後", { ts: tsAt(600) })) + "\n")
    const rewritten = await svc.list()
    await svc.settle()
    const after = await svc.list()
    expect(rewritten.sessions.find((s) => s.title === "実行中の作業")!.latestInstruction?.excerpt).toBe("書き直し後")
    expect(after.sessions.find((s) => s.title === "実行中の作業")!.digest).toBe("full")
  })

  it("メタデータの一部が壊れていても、前回の値で表示し続けて警告する(S4)", async () => {
    const fx = await fixture()
    await seed(fx)
    const svc = service(fx)
    await svc.list()

    const file = path.join(fx.sessionsDir, `${fakeSessionId(3)}.json`)
    await fs.writeFile(file, `{"sessionId":"${fakeSessionId(3)}","promptAppendSnapshot":"${SENTINEL}" BROKEN`)
    const future = new Date(NOW + 5000)
    await fs.utimes(file, future, future)
    const list = await svc.list()

    expect(list.sessions.find((s) => s.title === "確認待ちの作業")).toBeDefined()
    expect(list.warnings.some((w) => w.includes("解釈できませんでした"))).toBe(true)
    expect(JSON.stringify(list)).not.toContain(SENTINEL)
  })

  it("グループ情報が壊れても前回の値を使い、警告する(S4)", async () => {
    const fx = await fixture()
    await seed(fx)
    const svc = service(fx)
    await svc.list()

    const file = path.join(fx.dataDir, "claude_desktop_config.json")
    await fs.writeFile(file, `{"mcpServers":{"env":"${SENTINEL}" BROKEN`)
    const future = new Date(NOW + 5000)
    await fs.utimes(file, future, future)
    const list = await svc.list()

    expect(list.sessions.find((s) => s.title === "要対応の作業")!.group?.name).toBe("設計")
    expect(list.warnings.some((w) => w.includes("グループ情報"))).toBe(true)
    expect(JSON.stringify(list)).not.toContain(SENTINEL)
  })

  it("会話ログが見つからないセッションがあれば警告する", async () => {
    const fx = await fixture()
    await seed(fx)
    const list = await service(fx).list()
    expect(list.warnings.some((w) => w.includes("1件のセッションは会話ログが見つかりません"))).toBe(true)
  })
})

describe("縮退表示(Desktopのメタデータが無い場合)", () => {
  it("会話ログだけで一覧を作り、分類・グループ・ピン留めは表示しない", async () => {
    const fx = await fixture()
    const t = await writeTranscript(fx, fakeCliId(1), [
      { type: "custom-title", customTitle: "会話ログだけのセッション" },
      humanRow("会話ログだけの指示", { ts: tsAt(1) }),
      assistantRow({ stop: "end_turn", ts: tsAt(2), model: "claude-opus-5-5", effort: "high" }),
    ])
    await touch(t, NOW, 3600)
    const noDesktop = path.join(fx.dataDir, "..", "nothing")
    const svc = new DesktopSessionService({ dataDir: noDesktop, projectsRoot: fx.projectsRoot, now: () => NOW })
    const list = await svc.list()

    expect(list.source).toBe("transcript-only")
    expect(list.warnings[0]).toContain("縮退表示")
    expect(list.sessions).toHaveLength(1)
    expect(list.sessions[0]).toMatchObject({
      id: fakeCliId(1),
      title: "会話ログだけのセッション",
      status: "waiting",
      model: "claude-opus-5-5",
      effort: "high",
      group: null,
      pinned: false,
    })
    expect(list.groups).toEqual([])
  })

  it("Desktopのデータも会話ログも無ければ source は none", async () => {
    const fx = await fixture()
    const svc = new DesktopSessionService({
      dataDir: path.join(fx.dataDir, "..", "nothing"),
      projectsRoot: path.join(fx.projectsRoot, "missing"),
      now: () => NOW,
    })
    const list = await svc.list()
    expect(list.source).toBe("none")
    expect(list.sessions).toEqual([])
    // データが無いことは、画面の「セッションが見つかりません」の枠で1回だけ出す(⑧-2。warnings には同じ文を入れない)
    expect(list.warnings).toEqual([])
    expect(list.dataLocation.origin).toBe("explicit-config")
  })

  it("30日より古い会話ログは縮退表示に含めない", async () => {
    const fx = await fixture()
    const t = await writeTranscript(fx, fakeCliId(1), [humanRow("古い")])
    await touch(t, NOW, 40 * 24 * 3600)
    const svc = new DesktopSessionService({ dataDir: path.join(fx.dataDir, "..", "nothing"), projectsRoot: fx.projectsRoot, now: () => NOW })
    expect((await svc.list()).sessions).toEqual([])
  })
})

describe("DesktopSessionService.detail", () => {
  it("タスクリスト全体と、セッション監視への導線になるフォルダ名・ログIDを返す", async () => {
    const fx = await fixture()
    await seed(fx)
    const svc = service(fx)
    await svc.list()
    await svc.settle()
    const detail = await svc.detail(fakeSessionId(2))

    expect(detail?.tasks).toEqual([
      { content: "調査", status: "completed" },
      { content: "実装を進める", status: "in_progress" },
      { content: "検証", status: "pending" },
    ])
    expect(detail?.projectDirName).toBe("-sample-project-1")
    expect(detail?.transcriptId).toBe(fakeCliId(2))
    expect(detail?.lastCompactionAt).toBe(Date.parse(tsAt(2)))
  })

  it("存在しないIDは null", async () => {
    const fx = await fixture()
    await seed(fx)
    expect(await service(fx).detail("local_does-not-exist")).toBeNull()
  })
})

describe("実データとの照合で見つかった不具合の修正(合成データ)", () => {
  /** 会話の時刻を NOW 基準にする(状態の推定は会話の行の時刻を使うため) */
  const at = (agoSec: number) => new Date(NOW - agoSec * 1000).toISOString()

  it("他セッションからの指示(isMeta付きのpeer行)が最新の入力として表示され、人の指示は優先して残る", async () => {
    const fx = await fixture()
    await writeMeta(fx, makeMeta({ n: 1, title: "peerあり", category: "completed", summaryFor: fakeUuid(1) }))
    const peer = {
      ...humanRow("別セッションからの連絡です", { ts: at(7000), origin: { kind: "peer", from: "local_other" }, turnOrigin: "peer" }),
      isMeta: true,
    }
    const t = await writeTranscript(fx, fakeCliId(1), [
      humanRow("人の指示", { ts: at(9000) }),
      peer,
      assistantRow({ stop: "end_turn", uuid: fakeUuid(1), ts: at(6900) }),
    ])
    await touch(t, NOW, 6900)
    const svc = service(fx)
    await svc.list()
    await svc.settle()
    const s = (await svc.list()).sessions[0]
    expect(s.latestInstruction).toMatchObject({ origin: "human", excerpt: "人の指示" })
    expect(s.latestInputOrigin).toBe("peer")

    // 人の指示が無いセッションでは、他セッションの指示がそのまま最新の指示になる
    await writeMeta(fx, makeMeta({ n: 2, title: "peerのみ", category: "completed", summaryFor: fakeUuid(2) }))
    const t2 = await writeTranscript(fx, fakeCliId(2), [peer, assistantRow({ stop: "end_turn", uuid: fakeUuid(2), ts: at(6900) })])
    await touch(t2, NOW, 6900)
    // 時計を固定しているため、会話ログの所在キャッシュを使わないよう新しいサービスで取得する
    const only = (await service(fx).list()).sessions.find((x) => x.title === "peerのみ")!
    expect(only.latestInstruction).toMatchObject({ origin: "peer", excerpt: "別セッションからの連絡です" })
  })

  it("wrap_up で終わったセッションは、最後のステップが実行中のまま残らず、要約が無くても中断扱いにならない", async () => {
    const fx = await fixture()
    await writeMeta(fx, makeMeta({ n: 1, title: "wrap_upで終了", category: null as never }))
    const t = await writeTranscript(fx, fakeCliId(1), [
      humanRow("依頼", { ts: at(9000) }),
      planRow({ items: [{ content: "調査", status: "completed" }, { content: "報告", status: "in_progress" }] }, { ts: at(8900) }),
      assistantRow({ stop: "tool_use", ts: at(8800), tools: [{ name: "mcp__ccd_turn__wrap_up", input: { recap: "完了" }, id: "toolu_wrap" }] }),
      toolResultRow({ toolUseId: "toolu_wrap", ts: at(8790) }),
    ])
    await touch(t, NOW, 8790)
    const svc = service(fx)
    await svc.list()
    await svc.settle()
    const s = (await svc.list()).sessions[0]
    expect(s.phase).toEqual({ completed: 2, total: 2, currentStep: null })
    expect(s.status).toBe("waiting")
  })

  it("AskUserQuestion の回答待ちは、何日経っても中断ではなく要対応になる", async () => {
    const fx = await fixture()
    await writeMeta(fx, makeMeta({ n: 1, title: "質問中", category: "completed", summaryFor: "old" }))
    const t = await writeTranscript(fx, fakeCliId(1), [
      humanRow("依頼", { ts: at(86_400 * 5) }),
      assistantRow({ stop: "tool_use", ts: at(86_400 * 5 - 10), tools: [{ name: "AskUserQuestion", input: { questions: [] }, id: "toolu_q" }] }),
    ])
    await touch(t, NOW, 86_400 * 5)
    const svc = service(fx)
    const s = (await svc.list()).sessions[0]
    expect(s.status).toBe("blocked")
    expect(s.statusReason).toContain("回答待ち")
  })

  it("エラーの記録より後に活動があれば、エラー表示を解除する", async () => {
    const fx = await fixture()
    const base = { hasError: true }
    await writeMeta(fx, makeMeta({ n: 1, title: "回復済み", category: "completed", summaryFor: fakeUuid(1), error: "e", errorAt: NOW - 7200_000, lastActivityAt: NOW - 600_000 }))
    await writeMeta(fx, makeMeta({ n: 2, title: "エラーのまま", category: "completed", summaryFor: fakeUuid(2), error: "e", errorAt: NOW - 7200_000, lastActivityAt: NOW - 7200_000 }))
    for (const n of [1, 2]) {
      const t = await writeTranscript(fx, fakeCliId(n), [humanRow("x", { ts: at(7300) }), assistantRow({ stop: "end_turn", uuid: fakeUuid(n), ts: at(7200) })])
      await touch(t, NOW, 7200)
    }
    expect(base.hasError).toBe(true)
    const list = await service(fx).list()
    expect(list.sessions.find((x) => x.title === "回復済み")!.status).toBe("completed")
    expect(list.sessions.find((x) => x.title === "エラーのまま")!.status).toBe("error")
  })

  it("実測が60万トークンを超えるclaude-opus-4-8は1M上限として約6割と表示し、300%にならない", async () => {
    const fx = await fixture()
    await writeMeta(fx, makeMeta({ n: 1, title: "大きな会話", model: "claude-opus-4-8", category: "completed", summaryFor: fakeUuid(1) }))
    const t = await writeTranscript(fx, fakeCliId(1), [
      humanRow("依頼", { ts: at(7300) }),
      assistantRow({ stop: "end_turn", uuid: fakeUuid(1), ts: at(7200), model: "claude-opus-4-8", input: 7_659, cacheRead: 600_000 }),
    ])
    await touch(t, NOW, 7200)
    const s = (await service(fx).list()).sessions[0]
    expect(s.context).toMatchObject({ tokens: 607_659, limit: 1_000_000 })
    expect(Math.round(s.context!.ratio * 100)).toBe(61)
  })
})

describe("起動中のCLIプロセスの確認(段階2)", () => {
  async function seedTwo() {
    const fx = await fixture()
    for (const n of [1, 2]) {
      await writeMeta(fx, makeMeta({ n, title: `セッション${n}`, category: "completed", summaryFor: fakeUuid(n) }))
      const t = await writeTranscript(fx, fakeCliId(n), [
        humanRow("依頼", { ts: new Date(NOW - 7300_000).toISOString() }),
        assistantRow({ stop: "end_turn", uuid: fakeUuid(n), ts: new Date(NOW - 7200_000).toISOString() }),
      ])
      await touch(t, NOW, 7200)
    }
    return fx
  }

  it("プロセスがある/無いセッションを区別し、「実行中」の判定は変えない", async () => {
    const fx = await seedTwo()
    const svc = service(fx, { cliProcesses: { peek: () => new Set([fakeCliId(1)]) } })
    const list = await svc.list()
    const a = list.sessions.find((x) => x.title === "セッション1")!
    const b = list.sessions.find((x) => x.title === "セッション2")!
    expect(a.cliProcess).toBe("running")
    expect(b.cliProcess).toBe("none")
    // プロセスが残っていても、動いているとは限らない(待機中でもプロセスは残る)。状態は従来どおり
    expect(a.status).toBe("completed")
    expect((await svc.detail(fakeSessionId(1)))?.cliProcess).toBe("running")
  })

  it("取得できていない(Windows以外・失敗・初回の取得前)ときは「情報なし」として扱う", async () => {
    const fx = await seedTwo()
    const unknown = await service(fx, { cliProcesses: { peek: () => null } }).list()
    expect(unknown.sessions.every((x) => x.cliProcess === "unknown")).toBe(true)
    const none = await service(fx).list()
    expect(none.sessions.every((x) => x.cliProcess === "unknown")).toBe(true)
  })

  it("一覧の応答は、プロセスの確認の完了を待たない(peek を一覧1回につき1回、同期的に呼ぶだけ)", async () => {
    const fx = await seedTwo()
    let peeked = 0
    const svc = service(fx, {
      cliProcesses: {
        peek: () => {
          peeked++
          return new Set<string>()
        },
      },
    })
    const list = await svc.list()
    expect(peeked).toBe(1)
    expect(list.sessions.every((x) => x.cliProcess === "none")).toBe(true)
  })

  it("縮退表示(会話ログだけ)でも、会話ログのIDでプロセスの有無を表示する", async () => {
    const fx = await fixture()
    const t = await writeTranscript(fx, fakeCliId(1), [humanRow("指示"), assistantRow({ stop: "end_turn" })])
    await touch(t, NOW, 7200)
    const svc = new DesktopSessionService({
      dataDir: path.join(fx.dataDir, "..", "nothing"),
      projectsRoot: fx.projectsRoot,
      now: () => NOW,
      cliProcesses: { peek: () => new Set([fakeCliId(1)]) },
    })
    expect((await svc.list()).sessions[0].cliProcess).toBe("running")
  })
})

describe("他のセッションへの送信回数と送信上限（合成データ）", () => {
  const at = (agoSec: number) => new Date(NOW - agoSec * 1000).toISOString()

  it("一覧と詳細に、送信回数・停止中・届かなかった数を出す。送信の宛先や本文は出さない", async () => {
    const fx = await fixture()
    // 1: 10回送ったあと上限で止まっている
    await writeMeta(fx, makeMeta({ n: 1, title: "停止中のセッション", category: "completed", summaryFor: fakeUuid(1) }))
    const stopped = await writeTranscript(fx, fakeCliId(1), [
      humanRow("人の指示", { ts: at(9000) }),
      ...Array.from({ length: 10 }, (_, i) => [sendRow(i + 1, { ts: at(8000 - i) }), sendResultRow(i + 1, SYNTHETIC_SEND_OK, { ts: at(8000 - i) })]).flat(),
      sendRow(11, { ts: at(7000) }),
      sendResultRow(11, SYNTHETIC_SEND_LIMIT, { ts: at(7000), asBlocks: true }),
      assistantRow({ stop: "end_turn", uuid: fakeUuid(1), ts: at(6900) }),
    ])
    await touch(stopped, NOW, 6900)

    // 2: 3回送り、うち1回は届いていない
    await writeMeta(fx, makeMeta({ n: 2, title: "途中のセッション", category: "completed", summaryFor: fakeUuid(2) }))
    const partway = await writeTranscript(fx, fakeCliId(2), [
      humanRow("人の指示", { ts: at(9000) }),
      sendRow(1, { ts: at(8000) }),
      sendResultRow(1, SYNTHETIC_SEND_UNREACHABLE, { ts: at(8000) }),
      sendRow(2, { ts: at(7900) }),
      sendResultRow(2, SYNTHETIC_SEND_OK, { ts: at(7900) }),
      sendRow(3, { tool: "mcp__ccd_session_mgmt__send_message", ts: at(7800) }),
      sendResultRow(3, SYNTHETIC_SEND_OK, { ts: at(7800) }),
      assistantRow({ stop: "end_turn", uuid: fakeUuid(2), ts: at(6900) }),
    ])
    await touch(partway, NOW, 6900)

    // 3: 停止後に人が入力して解除された
    await writeMeta(fx, makeMeta({ n: 3, title: "解除されたセッション", category: "completed", summaryFor: fakeUuid(3) }))
    const released = await writeTranscript(fx, fakeCliId(3), [
      humanRow("人の指示", { ts: at(9000) }),
      sendRow(1, { ts: at(8000) }),
      sendResultRow(1, SYNTHETIC_SEND_LIMIT, { ts: at(8000) }),
      humanRow("続けてください", { ts: at(7500) }),
      assistantRow({ stop: "end_turn", uuid: fakeUuid(3), ts: at(6900) }),
    ])
    await touch(released, NOW, 6900)

    // 4: 会話ログが無い
    await writeMeta(fx, makeMeta({ n: 4, title: "ログなし", category: "completed", summaryFor: fakeUuid(4), noCliSessionId: true }))

    const svc = service(fx)
    await svc.list()
    await svc.settle()
    const list = await svc.list()
    const byTitle = (title: string) => list.sessions.find((s) => s.title === title)!

    expect(byTitle("停止中のセッション").messaging).toEqual({ sent: 10, limit: 10, stopped: true, undelivered: 1, exact: true })
    expect(byTitle("途中のセッション").messaging).toEqual({ sent: 3, limit: 10, stopped: false, undelivered: 1, exact: true })
    expect(byTitle("解除されたセッション").messaging).toEqual({ sent: 0, limit: 10, stopped: false, undelivered: 0, exact: true })
    expect(byTitle("ログなし").messaging).toBeNull()

    const detail = await svc.detail(byTitle("停止中のセッション").id)
    expect(detail?.messaging).toMatchObject({ stopped: true, sent: 10 })

    // 宛先・送信の本文・ツール結果の文は応答に含めない
    const json = JSON.stringify(list) + JSON.stringify(detail)
    expect(json).not.toContain("synthetic-target")
    expect(json).not.toContain("Delivered")
    expect(json).not.toContain("Not delivered")
  })
})
