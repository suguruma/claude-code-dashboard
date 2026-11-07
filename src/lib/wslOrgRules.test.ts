import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DesktopSessionService } from "./desktopSessionService"
import { isRemoteTranscriptPath, isSafePosixPath, projectMeta } from "./desktopSessions"
import { fakeSessionId, makeDesktopFixture, makeMeta, writeDesktopConfigs, writeMeta } from "./desktopFixtures"
import { OrgRulesService } from "./orgRulesService"
import { createWslAccess, listRunningViaWslExe, parseRunningList, type WslAccess } from "./wslAccess"

// ⑱ WSL の作業フォルダの決まりと記憶を読む(要件メモ 18 の W1〜W8。新しい設定は足さない＝指示63 の (2))

const cleanup: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-wsl-test-"))
  cleanup.push(dir)
  return dir
}

const TRANSCRIPT = "/home/someone/.claude/projects/-home-someone/0123abcd-0000-4000-8000-000000000001.jsonl"

describe("[W1] メタデータの取り込み", () => {
  const base = { sessionId: "local_00000000-0000-4000-8000-000000000001", title: "t", cwd: "/home/someone" }

  it("配布版の名前と会話記録のパスは、形に合うときだけ持つ。無いセッションの項目の一覧は変わらない", () => {
    const m = projectMeta({ ...base, wslConfig: { distro: "Ubuntu" }, sshRemoteTranscriptPath: TRANSCRIPT })!
    expect(m.wslDistro).toBe("Ubuntu")
    expect(m.remoteTranscriptPath).toBe(TRANSCRIPT)
    const plain = projectMeta(base)!
    expect(Object.keys(plain)).not.toContain("wslDistro")
    expect(Object.keys(plain)).not.toContain("remoteTranscriptPath")
  })

  it("形に合わない値は捨てる（区切り・`..`・空白の配布版、別の場所を指す会話記録のパス）", () => {
    for (const distro of ["../x", "a/b", "a\\b", "Ubu ntu", "..", "", "x".repeat(65)]) {
      expect(projectMeta({ ...base, wslConfig: { distro }, sshRemoteTranscriptPath: TRANSCRIPT })!.wslDistro, distro).toBeUndefined()
    }
    for (const p of [
      "//evil/share/.claude/projects/a/b.jsonl",
      "/home/x/../../etc/.claude/projects/a/b.jsonl",
      "/home/x/.claude/projects/a/b.txt",
      "/etc/shadow",
      "/home/x/.claude/projects/a\\b/c.jsonl",
      "C:/home/x/.claude/projects/a/b.jsonl",
    ]) {
      expect(isRemoteTranscriptPath(p), p).toBe(false)
    }
    // 配布版の名前が無ければ、会話記録のパスも持たない
    expect(projectMeta({ ...base, sshRemoteTranscriptPath: TRANSCRIPT })!.remoteTranscriptPath).toBeUndefined()
  })

  it("isSafePosixPath：`//host`・`..`・`.`・`\\`・`:`・NUL・`/` だけ を弾く", () => {
    expect(isSafePosixPath("/home/someone")).toBe(true)
    for (const p of ["//evil/share", "/home/../etc", "/home/./x", "/home/a\\b", "/home/a:b", "/home/a\0b", "/", "home/x", "/home//x"]) {
      expect(isSafePosixPath(p), JSON.stringify(p)).toBe(false)
    }
  })
})

describe("[W3・W6] wsl.exe と UNC のパス", () => {
  it("出力は UTF-16LE（BOM・CRLF つき）と UTF-8 の両方を読み、形に合わない行は捨てる", () => {
    const utf16 = Buffer.from("\uFEFFUbuntu\r\nDebian-12\r\n", "utf16le")
    expect(parseRunningList(utf16)).toEqual(["Ubuntu", "Debian-12"])
    expect(parseRunningList(Buffer.from("Ubuntu\nこれは案内の文です\n../x\n", "utf8"))).toEqual(["Ubuntu"])
    expect(parseRunningList(Buffer.alloc(0))).toEqual([])
  })

  it("wsl.exe は System32 の絶対パスで、固定の引数・窓を出さずに呼ぶ。失敗は「どれも動いていない」", async () => {
    const calls: Array<{ file: string; args: string[]; opts: Record<string, unknown> }> = []
    const ok = ((file: string, args: string[], opts: Record<string, unknown>, cb: (e: Error | null, out: Buffer) => void) => {
      calls.push({ file, args, opts })
      cb(null, Buffer.from("Ubuntu\r\n", "utf16le"))
    }) as never
    expect(await listRunningViaWslExe(ok)).toEqual(["Ubuntu"])
    expect(calls[0].file.toLowerCase()).toMatch(/\\system32\\wsl\.exe$/)
    expect(path.win32.isAbsolute(calls[0].file)).toBe(true)
    expect(calls[0].args).toEqual(["-l", "--running", "-q"])
    expect(calls[0].opts).toMatchObject({ windowsHide: true, timeout: 1500 })

    const failed = ((_f: string, _a: string[], _o: unknown, cb: (e: Error | null, out: Buffer) => void) =>
      cb(Object.assign(new Error("timeout"), { killed: true }), Buffer.from("Ubuntu\r\n", "utf16le"))) as never
    expect(await listRunningViaWslExe(failed)).toEqual([])
    const thrown = (() => {
      throw new Error("ENOENT")
    }) as never
    expect(await listRunningViaWslExe(thrown)).toEqual([])
  })

  it("Windows でなければ wsl.exe を呼ばない。同時の呼び出しは1つにまとめ、結果は覚えない（読む直前に問い直す）", async () => {
    const list = vi.fn(async () => ["Ubuntu"])
    expect([...(await createWslAccess({ platform: "linux", listRunning: list }).runningDistros())]).toEqual([])
    expect(list).not.toHaveBeenCalled()

    const access = createWslAccess({ platform: "win32", listRunning: list })
    const [a, b] = await Promise.all([access.runningDistros(), access.runningDistros()])
    expect([...a]).toEqual(["Ubuntu"])
    expect(b).toBe(a)
    expect(list).toHaveBeenCalledTimes(1)
    await access.runningDistros()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it("UNC のパスは `\\\\wsl.localhost\\<配布版>\\` の下だけ。形に合わない値は null", () => {
    const access = createWslAccess({ platform: "win32", listRunning: async () => [] })
    expect(access.toWindowsPath("Ubuntu", "/home/someone/CLAUDE.md")).toBe("\\\\wsl.localhost\\Ubuntu\\home\\someone\\CLAUDE.md")
    expect(access.toWindowsPath("../x", "/home/a")).toBeNull()
    expect(access.toWindowsPath("Ubuntu", "//evil/share")).toBeNull()
    expect(access.toWindowsPath("Ubuntu", "/home/../../x")).toBeNull()
    expect(access.toWindowsPath("Ubuntu", "/")).toBeNull()
    expect(access.toWindowsPath("Ubuntu", "/home/u/proj./CLAUDE.md")).toBeNull()
    expect(access.toWindowsPath("Ubuntu", "/home/u/proj /CLAUDE.md")).toBeNull()
    expect(access.toWindowsPath("Ubuntu", "/home/u/a?b/CLAUDE.md")).toBeNull()
  })
})

// 差し替えた根も Windows のパスで組み立てるため、Windows でだけ流す
describe.skipIf(process.platform !== "win32")("[W2・W4・W7] 組織のルール（フィクスチャ）", () => {
  const NOW = Date.UTC(2026, 0, 2, 0, 0, 0)

  /** 配布版の根を一時フォルダに差し替えた WslAccess。running は動いている配布版 */
  function fakeWsl(root: string, running: string[]) {
    const list = vi.fn(async () => running)
    const access: WslAccess = createWslAccess({ platform: "win32", rootOf: (d) => path.join(root, d) + "\\", listRunning: list })
    return { access, list }
  }

  async function setup(opts: { running?: string[]; secondDistro?: boolean; noWslConfig?: boolean; cwd?: string } = {}) {
    const root = await tmpDir()
    const fx = await makeDesktopFixture(path.join(root, "desktop"))
    const wslRoot = path.join(root, "wsl")
    const home = path.join(wslRoot, "Ubuntu", "home", "someone")
    await fs.mkdir(path.join(home, ".claude", "projects", "-home-someone", "memory"), { recursive: true })
    await fs.writeFile(path.join(home, "CLAUDE.md"), "## WSL の決まり\nWSL_RULE_BODY\n", "utf-8")
    await fs.writeFile(
      path.join(home, ".claude", "projects", "-home-someone", "memory", "wsl-note.md"),
      "---\nname: wsl-note\ndescription: WSL の記憶\nmetadata:\n  type: project\n---\nWSL_MEMORY_BODY\n",
      "utf-8"
    )
    const wslFields = opts.noWslConfig ? {} : { wslConfig: { distro: "Ubuntu" }, sshRemoteTranscriptPath: TRANSCRIPT }
    await writeMeta(fx, { ...makeMeta({ n: 1, title: "00_指揮役_WSL", cwd: opts.cwd ?? "/home/someone" }), ...wslFields })
    const groups = [{ id: "g1", name: "WSL の組", order: 1 }]
    const assignments: Record<string, string> = { [fakeSessionId(1)]: "g1" }
    if (opts.secondDistro) {
      await writeMeta(fx, { ...makeMeta({ n: 2, title: "00_指揮役_別", cwd: "/home/someone" }), wslConfig: { distro: "Debian" } })
      groups.push({ id: "g2", name: "別の組", order: 2 })
      assignments[fakeSessionId(2)] = "g2"
    }
    await writeDesktopConfigs(fx, { groups, assignments })
    const sessions = new DesktopSessionService({ dataDir: fx.dataDir, projectsRoot: fx.projectsRoot, now: () => NOW })
    const { access, list } = fakeWsl(wslRoot, opts.running ?? ["Ubuntu"])
    const service = new OrgRulesService(sessions, { config: async () => ({}), platform: "win32", env: {}, now: () => NOW, wsl: access })
    return { service, list, wslRoot, home }
  }

  it("動いている配布版なら、CLAUDE.md と記憶を読む。画面に返すパスは WSL のパスのまま", async () => {
    const { service, wslRoot } = await setup()
    const res = await service.get()
    const card = res.folders.find((f) => f.cwd === "/home/someone")!
    expect(card.claudeMd.status).toBe("ok")
    expect(card.claudeMd.path).toBe("/home/someone/CLAUDE.md")
    expect(card.claudeMd.sections.map((s) => s.title)).toEqual(["WSL の決まり"])
    expect(card.memory.status).toBe("ok")
    expect(card.memory.entries.map((e) => e.name)).toEqual(["wsl-note"])
    // 記憶の本文は一覧に出ない。置き場(差し替えた根)のパスも応答に出ない
    const json = JSON.stringify(res)
    expect(json).not.toContain("WSL_MEMORY_BODY")
    expect(json).not.toContain(wslRoot.replace(/\\/g, "\\\\"))
    expect(json).not.toContain("wsl.localhost")
    // W4：本文の API は一覧に出たファイルだけ
    expect((await service.memoryBody(card.key, "wsl-note.md"))?.body).toBe("WSL_MEMORY_BODY")
    expect(await service.memoryBody(card.key, "../CLAUDE.md")).toBeNull()
  })

  it("[W3] 配布版が止まっていれば読まず「止まっている」。本文の API も返さない", async () => {
    const { service } = await setup({ running: [] })
    const res = await service.get()
    const card = res.folders.find((f) => f.cwd === "/home/someone")!
    expect(card.claudeMd.status).toBe("wsl-stopped")
    expect(card.claudeMd.path).toBe("/home/someone/CLAUDE.md")
    expect(card.claudeMd.sections).toEqual([])
    expect(card.memory.status).toBe("wsl-stopped")
    expect(await service.memoryBody(card.key, "wsl-note.md")).toBeNull()
  })

  it("[高1] 危ない作業フォルダ（`//host`・`..`）は、配布版が動いていても開かず「読めない」。本文の API も返さない", async () => {
    for (const cwd of ["//evil/share/x", "/home/../home/someone", "/home/someone/proj."]) {
      const { service } = await setup({ cwd })
      const spy = vi.spyOn(fs, "stat")
      const card = (await service.get()).folders.find((f) => f.cwd === cwd)!
      expect(card.claudeMd.status, cwd).toBe("wsl")
      expect(card.memory.status, cwd).toBe("wsl")
      expect(await service.memoryBody(card.key, "wsl-note.md"), cwd).toBeNull()
      // 差し替えた根の下も、`//evil` のような場所も開きに行かない
      expect(spy.mock.calls.filter(([p]) => /evil|someone/.test(String(p))), cwd).toEqual([])
      spy.mockRestore()
    }
  })

  it("作業フォルダの末尾の `/` は削って読む", async () => {
    const { service } = await setup({ cwd: "/home/someone/" })
    const card = (await service.get()).folders.find((f) => f.cwd === "/home/someone/")!
    expect(card.claudeMd.status).toBe("ok")
  })

  it("[低6] 拒否リストは WSL の記憶にも効く（一覧にも本文にも出ない）", async () => {
    const { service, home } = await setup()
    await fs.writeFile(path.join(home, ".claude", "projects", "-home-someone", "memory", "credentials.md"), "---\nname: secret\n---\nSECRET\n", "utf-8")
    const card = (await service.get()).folders.find((f) => f.cwd === "/home/someone")!
    expect(card.memory.entries.map((e) => e.fileName)).toEqual(["wsl-note.md"])
    expect(await service.memoryBody(card.key, "credentials.md")).toBeNull()
  })

  it("配布版の名前が記録されていなければ「読めない」のまま、wsl.exe も呼ばない（推測しない）", async () => {
    const { service, list } = await setup({ noWslConfig: true })
    const card = (await service.get()).folders.find((f) => f.cwd === "/home/someone")!
    expect(card.claudeMd.status).toBe("wsl")
    expect(list).not.toHaveBeenCalled()
  })

  it("同じパスでも配布版が違えば別のカード。止まっている配布版の側は読まない", async () => {
    const { service } = await setup({ secondDistro: true })
    const cards = (await service.get()).folders.filter((f) => f.cwd === "/home/someone")
    expect(cards).toHaveLength(2)
    expect(new Set(cards.map((c) => c.key)).size).toBe(2)
    const byGroup = Object.fromEntries(cards.map((c) => [c.groups[0].groupName, c.claudeMd.status]))
    expect(byGroup).toEqual({ "WSL の組": "ok", "別の組": "wsl-stopped" })
  })
})
