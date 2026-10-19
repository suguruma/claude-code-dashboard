import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { GET as memoryGET } from "@/app/api/org-rules/memory/route"
import { AUTODETECT_ENV } from "./dataLocations"
import { DesktopSessionService } from "./desktopSessionService"
import { fakeCliId, fakeSessionId, humanRow, makeDesktopFixture, makeMeta, tsAt, writeDesktopConfigs, writeMeta, writeTranscript } from "./desktopFixtures"
import { OrgRulesService, parseOrgRulesConfig, type OrgRulesConfig } from "./orgRulesService"
import { claudeMdSections, findStaleRefs, markdownSections, memoryIndexTargets, pinSections } from "./orgRulesText"

const cleanup: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-org-rules-test-"))
  cleanup.push(dir)
  return dir
}

// ---------------------------------------------------------------------------
// 純粋な処理

describe("古いセッション名の判定（findStaleRefs）", () => {
  const titles = { live: ["05_SampleApp", "01_note-tool", "03_検証", "00_リーダー_試験"], archived: ["07_旧い担当"] }
  const texts = (text: string) => findStaleRefs(text, titles)

  it("空白の違い・後ろに語が続くものは「合う」", () => {
    expect(texts("担当は 05_Sample App の担当です。")).toEqual([])
    expect(texts("03_検証に頼む")).toEqual([])
    expect(texts("「00_リーダー_試験」が決める")).toEqual([])
  })

  it("番号の入れ替えで合わないものに印。同じ番号・同じ名前の今の題名を手がかりに添える", () => {
    expect(texts("検証は 05_検証 に頼む")).toEqual([
      { text: "05_検証", kind: "mismatch", sameNumber: ["05_SampleApp"], sameName: ["03_検証"] },
    ])
    expect(texts("01_SampleApp を見る")).toEqual([
      { text: "01_SampleApp", kind: "mismatch", sameNumber: ["01_note-tool"], sameName: ["05_SampleApp"] },
    ])
  })

  it("アーカイブ済みのセッションの題名とだけ合うものは archived", () => {
    expect(texts("07_旧い担当 に聞く")).toEqual([{ text: "07_旧い担当", kind: "archived", sameNumber: [], sameName: [] }])
  })

  it("雛形・例の書き方は対象にしない（<…>・…・...・数字だけ・名前なし・ファイル名の途中）", () => {
    expect(texts("指揮役は 00_リーダー_<グループ> にする")).toEqual([])
    expect(texts("例：「05_…」")).toEqual([])
    expect(texts("05_... のように書く")).toEqual([])
    expect(texts("タイトルが 00_ で始まる")).toEqual([])
    expect(texts("10_000 件")).toEqual([])
    expect(texts("report_05_x.md と v2_09_y")).toEqual([])
  })

  it("同じ語は1回だけ数える", () => {
    expect(texts("09_旧名 と 09_旧名")).toHaveLength(1)
  })
})

describe("節の分け方と並べ方", () => {
  it("CLAUDE.md は ## 見出しごと。無効の節は enabled: false。CRLF でもよい", () => {
    const parsed = claudeMdSections("# 題\r\n\r\n## A\r\n本文A\r\n<!-- CCD:DISABLED\r\n## B\r\n本文B\r\n-->\r\n", null)
    expect(parsed.preamble).toBe("# 題")
    expect(parsed.sections.map((s) => [s.title, s.enabled, s.body])).toEqual([
      ["A", true, "本文A"],
      ["B", false, "本文B"],
    ])
  })

  it("追加のファイル(.md)は # 〜 ### の見出しごと", () => {
    const parsed = markdownSections("前書き\n# 一\nあ\n## 二\nい\n#### 四は見出しにしない\n", null)
    expect(parsed.preamble).toBe("前書き")
    expect(parsed.sections.map((s) => [s.title, s.body])).toEqual([
      ["一", "あ"],
      ["二", "い\n#### 四は見出しにしない"],
    ])
  })

  it("先頭に出す節を指定の順で前に出し、pinned を付ける。無い名前は飛ばす", () => {
    const sections = [{ title: "出力形式" }, { title: "セッションの題名" }, { title: "組織の運用（全グループ共通）" }, { title: "その他" }]
    const ordered = pinSections(sections, ["組織の運用", "無い節", "セッションの題名"])
    expect(ordered.map((s) => [s.title, s.pinned])).toEqual([
      ["組織の運用（全グループ共通）", true],
      ["セッションの題名", true],
      ["出力形式", false],
      ["その他", false],
    ])
  })

  it("記憶の索引からリンク先の .md のファイル名を取り出す", () => {
    expect([...memoryIndexTargets("- [a](a.md) — x\n- [b](sub/b.md)\n- [c](https://example.com/c)\n- [日本](%E6%97%A5.md)")].sort()).toEqual(["a.md", "b.md", "日.md"])
  })

  it("設定ファイルの形の合わない項目は無視する", () => {
    expect(parseOrgRulesConfig({ pinnedSections: ["A", 1, ""], globalClaudeMdPath: " ", extraFiles: [{ path: "x.md" }, { label: "L", path: "" }, 3] })).toEqual({
      pinnedSections: ["A"],
      extraFiles: [{ label: "x.md", path: "x.md" }],
    })
    expect(parseOrgRulesConfig(null)).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// 合成データ(scripts/make-org-chart-sample.mjs)で組み立てる

interface OrgRulesExpected {
  folderCount: number
  globalSectionOrder: string[]
  staleTotal: number
  staleRefs: string[]
  memoryCounts: Record<string, number>
  notInIndex: string[]
  missingFromDisk: string[]
  privateMarker: string
}

interface Sample {
  dataDir: string
  projectsRoot: string
  orgRulesConfig: { globalClaudeMdPath: string; extraFiles: Array<{ label: string; path: string }> }
  write: () => Promise<void>
  ids: Record<string, string>
  expected: { orgRules: OrgRulesExpected }
}

async function sampleService(extraConfig: Partial<OrgRulesConfig> = {}) {
  const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(process.cwd(), "scripts", "make-org-chart-sample.mjs")).href)) as {
    makeOrgChartSample: (outDir: string, options?: { now?: number }) => Sample
  }
  const now = Date.now()
  const out = await tmpDir()
  const sample = mod.makeOrgChartSample(path.join(out, "sample"), { now })
  await sample.write()
  const sessions = new DesktopSessionService({ dataDir: sample.dataDir, projectsRoot: sample.projectsRoot, now: () => now })
  const config: OrgRulesConfig = { ...sample.orgRulesConfig, ...extraConfig }
  const service = new OrgRulesService(sessions, { config: async () => config, now: () => now, env: {} })
  return { sample, service, out, now, expected: sample.expected.orgRules }
}

describe("OrgRulesService（合成データ）", () => {
  it("R1・R2: 全体の決まりは「組織の運用」「セッションの題名」が先頭、残りはファイルの順。無効の節は無効のまま", async () => {
    const { service, expected } = await sampleService()
    const res = await service.get()
    expect(res.global.status).toBe("ok")
    expect(res.global.sections.map((s) => s.title)).toEqual(expected.globalSectionOrder)
    expect(res.global.sections.map((s) => s.pinned)).toEqual([true, true, false, false])
    expect(res.global.sections.find((s) => s.title === "使わなくなった決まり")?.enabled).toBe(false)
  })

  it("R3: 指揮役は組織図と同じ人。作業フォルダごとに1枚。試験グループだけ CLAUDE.md がある", async () => {
    const { service, expected } = await sampleService()
    const res = await service.get()
    expect(res.foldersStatus).toBe("ok")
    expect(res.folders).toHaveLength(expected.folderCount)
    expect(res.folders.map((f) => f.groups)).toEqual([
      [{ groupName: "試験グループ", leaderTitle: "00_リーダー_試験" }],
      [{ groupName: "別グループ", leaderTitle: "00_リーダー_別" }],
    ])
    expect(res.folders[0].claudeMd.status).toBe("ok")
    expect(res.folders[0].claudeMd.sections.map((s) => s.title)).toEqual(["進め方"])
    expect(res.folders[1].claudeMd.status).toBe("missing")
  })

  it("R4・R8: 記憶の一覧(name・description・type・更新日)と、索引とのずれ。一覧の応答に本文は入らない", async () => {
    const { service, sample, expected, now } = await sampleService()
    const res = await service.get()
    const [a, b] = res.folders
    expect(a.memory.entries).toHaveLength(expected.memoryCounts[sample.ids.leaderA])
    expect(b.memory.entries).toHaveLength(expected.memoryCounts[sample.ids.leaderB])
    expect(a.memory.typeCounts).toEqual({ project: 1, feedback: 1, reference: 1 })
    const structure = a.memory.entries.find((e) => e.fileName === "team-structure.md")
    expect(structure).toMatchObject({ name: "team-structure", description: "試験グループの担当の分け方", type: "project", staleCount: 1 })
    // 更新日は、フロントマターの modified（合成データは作った時刻の3時間前）
    expect(structure?.updatedAt).toBe(now - 3 * 3_600_000)
    expect(a.memory.entries.filter((e) => e.notInIndex).map((e) => e.fileName)).toEqual(expected.notInIndex)
    expect(a.memory.missingFromDisk).toEqual(expected.missingFromDisk)
    // 本文(「受け持つ」を含む)は一覧の応答に入らない
    expect(JSON.stringify(res)).not.toContain("受け持つ")
  })

  it("R4: 本文は、一覧に出たフォルダとファイル名でだけ取れる", async () => {
    const { service } = await sampleService()
    const res = await service.get()
    const key = res.folders[0].key
    const body = await service.memoryBody(key, "team-structure.md")
    expect(body?.body).toContain("受け持つ")
    expect(body?.staleRefs.map((r) => r.text)).toEqual(["08_文書の整備"])
    expect(await service.memoryBody(key, "MEMORY.md")).toBeNull()
    expect(await service.memoryBody(key, "gone.md")).toBeNull()
    expect(await service.memoryBody(key, "../../-sample-org-chart/memory/private-note.md")).toBeNull()
    expect(await service.memoryBody("000000000000", "team-structure.md")).toBeNull()
  })

  it("R5: 指揮役でないセッションのフォルダの記憶は読まない（目印がどの応答にも無く、そのフォルダを開かない）", async () => {
    const { service, sample, expected } = await sampleService()
    const privateDir = path.resolve(path.join(sample.projectsRoot, "-sample-org-chart", "memory")).toLowerCase()
    const seen: string[] = []
    for (const name of ["readdir", "readFile", "stat", "open"] as const) {
      const original = fs[name] as (...args: unknown[]) => unknown
      vi.spyOn(fs, name).mockImplementation(((...args: unknown[]) => {
        if (typeof args[0] === "string") seen.push(path.resolve(args[0]).toLowerCase())
        return original.apply(fs, args)
      }) as never)
    }
    const res = await service.get()
    const bodies = await Promise.all(res.folders.flatMap((f) => f.memory.entries.map((e) => service.memoryBody(f.key, e.fileName))))
    const json = JSON.stringify(res) + JSON.stringify(bodies)
    expect(json).not.toContain(expected.privateMarker)
    expect(seen.filter((p) => p.startsWith(privateDir))).toEqual([])
  })

  it("R7: 古いセッション名の印の合計と中身が、合成データの期待値と同じ", async () => {
    const { service, expected } = await sampleService()
    const res = await service.get()
    expect(res.staleChecked).toBe(true)
    expect(res.staleTotal).toBe(expected.staleTotal)
    const refs = [
      ...res.global.sections.flatMap((s) => s.staleRefs.map((r) => r.text)),
      ...res.folders.flatMap((f) => f.claudeMd.sections.flatMap((s) => s.staleRefs.map((r) => r.text))),
    ]
    expect(refs.sort()).toEqual(expected.staleRefs.filter((r) => r !== "08_文書の整備").sort())
    const sixth = res.global.sections.flatMap((s) => s.staleRefs).find((r) => r.text === "06_集計の作成")
    expect(sixth?.sameName).toEqual(["02_集計の作成"])
  })

  it("R6・R11: 追加のファイルは設定に書いたものだけ。拒否リスト・.md/.txt 以外・1MB 超・無いファイルは読まずに理由", async () => {
    const out = await tmpDir()
    const big = path.join(out, "big.md")
    await fs.writeFile(big, "x".repeat(1024 * 1024 + 1), "utf-8")
    const txt = path.join(out, "memo.txt")
    await fs.writeFile(txt, "テキストのメモ", "utf-8")
    const creds = path.join(out, ".credentials.json")
    await fs.writeFile(creds, "{}", "utf-8")
    const env = path.join(out, ".env")
    await fs.writeFile(env, "X=1", "utf-8")
    const json = path.join(out, "data.json")
    await fs.writeFile(json, "{}", "utf-8")
    const { service } = await sampleService({
      extraFiles: [
        { label: "JSON", path: json },
        { label: "テキスト", path: txt },
        { label: "大きい", path: big },
        { label: "認証", path: creds },
        { label: "環境", path: env },
        { label: "無い", path: path.join(out, "none.md") },
      ],
    })
    const readSpy = vi.spyOn(fs, "readFile")
    const res = await service.get()
    expect(res.extras.map((e) => [e.label, e.file.status])).toEqual([
      ["JSON", "unsupported"],
      ["テキスト", "ok"],
      ["大きい", "too-large"],
      ["認証", "refused"],
      ["環境", "refused"],
      ["無い", "missing"],
    ])
    expect(res.extras[1].file.sections[0].body).toBe("テキストのメモ")
    const readPaths = readSpy.mock.calls.map((c) => String(c[0]))
    expect(readPaths).not.toContain(creds)
    expect(readPaths).not.toContain(env)
    expect(readPaths).not.toContain(big)
    expect(readPaths).not.toContain(json)
  })

  it("R11: 合成データの台帳は見出しごとに出る。設定が無ければ追加のファイルは空", async () => {
    const { service } = await sampleService()
    const res = await service.get()
    expect(res.extras.map((e) => [e.label, e.file.status, e.file.sections.map((s) => s.title)])).toEqual([["台帳（合成のデータ）", "ok", ["台帳（合成のデータ）", "運用のメモ"]]])
    const { service: none } = await sampleService({ extraFiles: [] })
    expect((await none.get()).extras).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// フィクスチャで、WSL・会話ログなし・同じ作業フォルダ・データなしの扱いを確かめる

describe("OrgRulesService（フィクスチャ）", () => {
  const NOW = Date.UTC(2026, 0, 2, 0, 0, 0)

  async function fixtureService(platform: NodeJS.Platform = "win32", config: OrgRulesConfig = {}, env: Record<string, string> = {}) {
    const root = await tmpDir()
    const fx = await makeDesktopFixture(root)
    const shared = path.join(root, "shared-work")
    await fs.mkdir(shared, { recursive: true })
    await fs.writeFile(path.join(shared, "CLAUDE.md"), "## 共有の決まり\n共有の本文\n@imported.md\n", "utf-8")
    // @ の読み込み先。読まれれば目印が応答に出る
    await fs.writeFile(path.join(shared, "imported.md"), "## 読み込み先\nIMPORTED_MARKER_9\n", "utf-8")
    // 1・2: 同じ作業フォルダの指揮役(別々のグループ)。3: WSL の作業フォルダ。4: 会話ログの無い指揮役
    await writeMeta(fx, makeMeta({ n: 1, title: "00_指揮役_一", cwd: shared }))
    await writeMeta(fx, makeMeta({ n: 2, title: "00_指揮役_二", cwd: shared }))
    await writeMeta(fx, makeMeta({ n: 3, title: "00_指揮役_三", cwd: "/home/someone" }))
    await writeMeta(fx, makeMeta({ n: 4, title: "00_指揮役_四", cwd: path.join(root, "work4") }))
    // 5: グループに入っていない 00_ のセッション。6: アーカイブ済みの 00_ のセッション(四の組で一番古い)。どちらも指揮役にしない
    await writeMeta(fx, makeMeta({ n: 5, title: "00_指揮役_外", cwd: path.join(root, "outside") }))
    await writeMeta(fx, makeMeta({ n: 6, title: "00_指揮役_古", cwd: path.join(root, "archived"), isArchived: true, createdAt: 1_600_000_000_000 }))
    await writeTranscript(fx, fakeCliId(1), [humanRow("合成の指示", { ts: tsAt(1) })], "-shared-work")
    await writeTranscript(fx, fakeCliId(2), [humanRow("合成の指示", { ts: tsAt(1) })], "-shared-work")
    await fs.mkdir(path.join(fx.projectsRoot, "-shared-work", "memory"), { recursive: true })
    await fs.writeFile(path.join(fx.projectsRoot, "-shared-work", "memory", "note.md"), "---\nname: note\ndescription: 共有の記憶\nmetadata:\n  type: project\n---\n本文\n", "utf-8")
    await writeDesktopConfigs(fx, {
      groups: [
        { id: "g1", name: "一の組", order: 1 },
        { id: "g2", name: "二の組", order: 2 },
        { id: "g3", name: "三の組", order: 3 },
        { id: "g4", name: "四の組", order: 4 },
      ],
      assignments: { [fakeSessionId(1)]: "g1", [fakeSessionId(2)]: "g2", [fakeSessionId(3)]: "g3", [fakeSessionId(4)]: "g4", [fakeSessionId(6)]: "g4" },
    })
    const sessions = new DesktopSessionService({ dataDir: fx.dataDir, projectsRoot: fx.projectsRoot, now: () => NOW })
    return { root, service: new OrgRulesService(sessions, { config: async () => config, platform, env, now: () => NOW }) }
  }

  it("同じ作業フォルダの指揮役は1枚にまとまり、効くグループが並ぶ", async () => {
    const { service } = await fixtureService()
    const res = await service.get()
    const shared = res.folders.find((f) => f.groups.length === 2)
    expect(shared?.groups.map((g) => g.groupName)).toEqual(["一の組", "二の組"])
    expect(shared?.claudeMd.sections.map((s) => s.title)).toEqual(["共有の決まり"])
    // R2: @ の行は文字のまま出し、読み込み先のファイルは開かない
    expect(shared?.claudeMd.sections[0]?.body).toContain("@imported.md")
    expect(JSON.stringify(res)).not.toContain("IMPORTED_MARKER_9")
    expect(shared?.memory.entries.map((e) => e.name)).toEqual(["note"])
  })

  it("R3: グループに入っていない 00_ のセッションと、アーカイブ済みのセッションは指揮役にならない", async () => {
    const { service, root } = await fixtureService()
    const res = await service.get()
    expect(res.folders.map((f) => f.cwd)).not.toContain(path.join(root, "outside"))
    expect(res.folders.map((f) => f.cwd)).not.toContain(path.join(root, "archived"))
    expect(res.folders.find((f) => f.groups[0]?.groupName === "四の組")?.groups[0]?.leaderTitle).toBe("00_指揮役_四")
  })

  it("R9: WSL の作業フォルダは「読めない」、会話ログの無い指揮役は記憶の場所が分からない。どちらも落ちない", async () => {
    const { service } = await fixtureService()
    const res = await service.get()
    const wsl = res.folders.find((f) => f.cwd === "/home/someone")
    expect(wsl?.claudeMd.status).toBe("wsl")
    expect(wsl?.memory.status).toBe("wsl")
    const noLog = res.folders.find((f) => f.groups[0]?.groupName === "四の組")
    expect(noLog?.claudeMd.status).toBe("missing")
    expect(noLog?.memory.status).toBe("unknown")
    expect(res.folders).toHaveLength(3)
  })

  it("Windows 以外では /home/... もこの PC のパスとして読む", async () => {
    const { service } = await fixtureService("linux")
    const res = await service.get()
    expect(res.folders.find((f) => f.cwd === "/home/someone")?.claudeMd.status).toBe("missing")
  })

  it("R10: Desktop のデータが無いときは指揮役を探さず、古い名前も調べない。グローバルの CLAUDE.md は読む", async () => {
    const root = await tmpDir()
    const globalMd = path.join(root, "CLAUDE.md")
    await fs.writeFile(globalMd, "## 組織の運用\n05_誰か に頼む\n", "utf-8")
    const sessions = new DesktopSessionService({ dataDir: path.join(root, "none"), projectsRoot: path.join(root, "none"), now: () => NOW })
    const service = new OrgRulesService(sessions, { config: async () => ({ globalClaudeMdPath: globalMd }), env: {}, now: () => NOW })
    const res = await service.get()
    expect(res.foldersStatus).toBe("no-desktop")
    expect(res.folders).toEqual([])
    expect(res.staleChecked).toBe(false)
    expect(res.global.sections[0].staleRefs).toEqual([])
    expect(res.global.status).toBe("ok")
  })

  it("自動の探索を止めていて場所の指定が無ければ、グローバルの CLAUDE.md は読まない（disabled）", async () => {
    const root = await tmpDir()
    const sessions = new DesktopSessionService({ dataDir: path.join(root, "none"), projectsRoot: path.join(root, "none"), now: () => NOW })
    const service = new OrgRulesService(sessions, { config: async () => ({}), env: { [AUTODETECT_ENV]: "0" }, now: () => NOW })
    const readSpy = vi.spyOn(fs, "readFile")
    const res = await service.get()
    expect(res.global.status).toBe("disabled")
    expect(readSpy.mock.calls.map((c) => String(c[0])).filter((p) => p.endsWith("CLAUDE.md"))).toEqual([])
  })
})

describe("記憶の本文の API（形の検証）", () => {
  it.each([
    ["folder が無い", "?file=a.md"],
    ["folder の形が違う", "?folder=../x&file=a.md"],
    ["ファイル名に区切り文字", "?folder=0123456789ab&file=..%2Fa.md"],
    ["親フォルダへの移動", "?folder=0123456789ab&file=..a.md"],
    [".md 以外", "?folder=0123456789ab&file=a.txt"],
  ])("%s は 400", async (_name, query) => {
    const res = await memoryGET(new Request(`http://127.0.0.1/api/org-rules/memory${query}`))
    expect(res.status).toBe(400)
  })
})
