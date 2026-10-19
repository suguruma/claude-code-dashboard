import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AUTODETECT_ENV,
  defaultClaudeProjectsRoot,
  defaultSnapshotsPath,
  isAutodetectDisabled,
  locateData,
  resolveProjectsRoot,
} from "./dataLocations"
import { DesktopSessionService } from "./desktopSessionService"
import { locateDesktopDataDir } from "./desktopSessions"
import { assistantRow, fakeCliId, humanRow, makeDesktopFixture, makeMeta, tsAt, writeMeta, writeTranscript, type DesktopFixture } from "./desktopFixtures"
import { FlowService } from "./flowService"
import { HousekeepingService } from "./housekeepingService"
import { listSessionProjects } from "./sessionMonitor"
import { UsageService } from "./usageService"

describe("isAutodetectDisabled", () => {
  it.each([
    ["0", true],
    [" 0 ", true],
    ["1", false],
    ["false", false],
    ["", false],
    [undefined, false],
  ])("%j → %s", (value, expected) => {
    expect(isAutodetectDisabled({ [AUTODETECT_ENV]: value })).toBe(expected)
  })
})

describe("locateData（設定ファイル → 環境変数 → 自動）", () => {
  const auto = () => "AUTO"
  it.each([
    { name: "設定ファイルが最優先", configured: "C", env: { X: "E" }, expected: { path: "C", origin: "explicit-config" } },
    { name: "設定が無ければ環境変数", configured: null, env: { X: "E" }, expected: { path: "E", origin: "explicit-env" } },
    { name: "空白だけの設定は無いのと同じ", configured: "  ", env: { X: "E" }, expected: { path: "E", origin: "explicit-env" } },
    { name: "明示が無ければ自動", configured: undefined, env: {}, expected: { path: "AUTO", origin: "auto" } },
    { name: "自動を止めていれば null", configured: undefined, env: { [AUTODETECT_ENV]: "0" }, expected: { path: null, origin: "disabled" } },
    { name: "止めていても設定ファイルは読む", configured: "C", env: { [AUTODETECT_ENV]: "0" }, expected: { path: "C", origin: "explicit-config" } },
    { name: "止めていても環境変数は読む", configured: null, env: { [AUTODETECT_ENV]: "0", X: "E" }, expected: { path: "E", origin: "explicit-env" } },
  ])("$name", ({ configured, env, expected }) => {
    expect(locateData(configured, "X", auto, env)).toEqual(expected)
  })

  it("会話ログのルート：止めていて明示が無ければ null、環境変数があればそれ", () => {
    expect(resolveProjectsRoot(null, { [AUTODETECT_ENV]: "0" })).toBeNull()
    expect(resolveProjectsRoot(null, { [AUTODETECT_ENV]: "0", CLAUDE_DESKTOP_PROJECTS_ROOT: "R" })).toBe("R")
    expect(resolveProjectsRoot("S", { [AUTODETECT_ENV]: "0" })).toBe("S")
    expect(resolveProjectsRoot(null, {})).toBe(defaultClaudeProjectsRoot())
  })
})

// ---------------------------------------------------------------------------
// 「本物のデータ」に見立てたおとりを、ホームのフォルダと AppData に置き、スイッチの有無で読む・読まないを確かめる

const NOW = Date.UTC(2026, 0, 2, 0, 0, 0)
const ENV_KEYS = ["USERPROFILE", "HOME", "LOCALAPPDATA", "APPDATA", AUTODETECT_ENV, "CLAUDE_DESKTOP_DATA_DIR", "CLAUDE_DESKTOP_PROJECTS_ROOT"]
const DECOY_TITLE = "おとりのセッション（読まれてはいけない）"

let saved: Record<string, string | undefined> = {}
let root = ""
let decoyHome = ""

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-data-locations-test-"))
  decoyHome = path.join(root, "home")
  process.env.USERPROFILE = decoyHome
  process.env.HOME = decoyHome
  process.env.LOCALAPPDATA = path.join(decoyHome, "AppData", "Local")
  process.env.APPDATA = path.join(decoyHome, "AppData", "Roaming")
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  await fs.rm(root, { recursive: true, force: true })
})

/** 自動の探索が見に行く場所(OS ごとの Desktop のデータフォルダの候補の1つ) */
function decoyDesktopDir(): string {
  if (process.platform === "win32") return path.join(decoyHome, "AppData", "Local", "Claude")
  if (process.platform === "darwin") return path.join(decoyHome, "Library", "Application Support", "Claude")
  return path.join(decoyHome, ".config", "Claude")
}

/** おとり: Desktop のメタデータ1件・既定の会話ログ1件・既定の公式値の記録 */
async function plantDecoy(): Promise<void> {
  const fx = await makeDesktopFixture(path.join(root, "decoy-src"))
  const sessionsDir = path.join(decoyDesktopDir(), "claude-code-sessions", "acct", "org")
  await fs.mkdir(sessionsDir, { recursive: true })
  const decoyFx: DesktopFixture = { dataDir: decoyDesktopDir(), projectsRoot: defaultClaudeProjectsRoot(), sessionsDir }
  await writeMeta(decoyFx, makeMeta({ n: 1, title: DECOY_TITLE }))
  await writeTranscript(decoyFx, fakeCliId(1), [humanRow("おとりの指示", { ts: tsAt(1) }), assistantRow({ ts: tsAt(2) })])
  await fs.mkdir(path.dirname(defaultSnapshotsPath()), { recursive: true })
  await fs.writeFile(defaultSnapshotsPath(), "", "utf-8")
  await fs.rm(fx.dataDir, { recursive: true, force: true })
}

/** fs の読み取りを見張り、渡されたパスを集める */
function watchReads(): string[] {
  const seen: string[] = []
  for (const name of ["readdir", "stat", "lstat", "readFile", "open", "access"] as const) {
    const original = fs[name] as (...args: unknown[]) => unknown
    vi.spyOn(fs, name).mockImplementation(((...args: unknown[]) => {
      if (typeof args[0] === "string") seen.push(path.resolve(args[0]))
      return original.apply(fs, args)
    }) as never)
  }
  return seen
}

const underDecoy = (seen: string[]) => seen.filter((p) => p.toLowerCase().startsWith(path.resolve(decoyHome).toLowerCase()))

describe("自動の探索のスイッチ（⑧-2）", () => {
  it("スイッチが無いときは、今までどおり自動で探す（おとりが見つかり、出どころは auto）", async () => {
    await plantDecoy()
    const svc = new DesktopSessionService({ now: () => NOW })
    const list = await svc.list()
    expect(list.dataLocation).toEqual({ path: decoyDesktopDir(), origin: "auto" })
    expect(list.sessions.map((s) => s.title)).toContain(DECOY_TITLE)
  })

  it("CCD_DESKTOP_AUTODETECT=0 で明示が無いときは、ホーム・AppData の下を1つも開かない（一覧・利用上限・セッション監視・整理）", async () => {
    await plantDecoy()
    process.env[AUTODETECT_ENV] = "0"
    const seen = watchReads()

    const sessions = new DesktopSessionService({ now: () => NOW })
    const list = await sessions.list()
    expect(list.source).toBe("none")
    expect(list.dataLocation).toEqual({ path: null, origin: "disabled" })
    expect(list.sessions).toEqual([])

    const usage = new UsageService({ now: () => NOW })
    const usageResponse = await usage.get()
    expect(JSON.stringify(usageResponse)).not.toContain(DECOY_TITLE)

    expect(await listSessionProjects()).toEqual([])

    const housekeeping = new HousekeepingService(sessions, new FlowService(sessions), { now: () => NOW, usage: async () => usage })
    const hk = await housekeeping.get()
    expect(JSON.stringify(hk)).not.toContain(DECOY_TITLE)

    expect(underDecoy(seen)).toEqual([])
  })

  it("CCD_DESKTOP_AUTODETECT=0 でも、設定ファイルで明示した場所は読む（出どころは explicit-config）", async () => {
    process.env[AUTODETECT_ENV] = "0"
    const fx = await makeDesktopFixture(path.join(root, "synthetic"))
    await writeMeta(fx, makeMeta({ n: 2, title: "合成のセッション" }))
    const list = await new DesktopSessionService({ dataDir: fx.dataDir, projectsRoot: fx.projectsRoot, now: () => NOW }).list()
    expect(list.dataLocation).toEqual({ path: fx.dataDir, origin: "explicit-config" })
    expect(list.sessions.map((s) => s.title)).toEqual(["合成のセッション"])
  })

  it("環境変数で明示したデータフォルダは explicit-env。明示した場所が無ければ場所は null で、出どころは明示のまま", async () => {
    const fx = await makeDesktopFixture(path.join(root, "synthetic"))
    expect(await locateDesktopDataDir(null, { CLAUDE_DESKTOP_DATA_DIR: fx.dataDir, [AUTODETECT_ENV]: "0" })).toEqual({
      path: fx.dataDir,
      origin: "explicit-env",
    })
    expect(await locateDesktopDataDir(path.join(root, "missing"), { [AUTODETECT_ENV]: "0" })).toEqual({ path: null, origin: "explicit-config" })
  })
})
