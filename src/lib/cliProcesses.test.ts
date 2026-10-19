import { describe, expect, it, vi } from "vitest"
import {
  CliProcessWatcher,
  LIST_RESUME_IDS_SCRIPT,
  encodeScript,
  parseResumeIds,
  runPowerShellListing,
} from "./cliProcesses"
import { fakeCliId } from "./desktopFixtures"

describe("parseResumeIds", () => {
  it("UUIDの行だけを小文字の集合にし、それ以外の行・空行は捨てる", () => {
    const upper = "ABCDEF00-1111-4111-8111-000000000001"
    const ids = parseResumeIds(`${upper}\r\n\r\n${fakeCliId(2)}\nnot-a-uuid\nclaude.exe --resume=${fakeCliId(3)} --model x\n  ${fakeCliId(2)}  \n`)
    expect([...ids].sort()).toEqual([fakeCliId(2), "abcdef00-1111-4111-8111-000000000001"])
  })

  it("コマンドライン全体のような長い行は、UUIDを含んでいても取り込まない", () => {
    expect(parseResumeIds(`claude.exe --settings {"env":{"KEY":"secret"}} --resume=${fakeCliId(1)}`).size).toBe(0)
  })
})

describe("固定のコマンド", () => {
  it("claude.exe を対象にした固定のスクリプトで、UUID以外を出力しない。ユーザーの入力を埋め込む余地が無い", () => {
    expect(LIST_RESUME_IDS_SCRIPT).toContain("Get-CimInstance Win32_Process")
    expect(LIST_RESUME_IDS_SCRIPT).toContain("Name='claude.exe'")
    expect(LIST_RESUME_IDS_SCRIPT).toContain("$Matches[1]")
    // 終了・変更を行うコマンドを含まない
    expect(LIST_RESUME_IDS_SCRIPT).not.toMatch(/Stop-Process|Remove-|Set-|Invoke-|taskkill|Kill\(/i)
  })

  it("-EncodedCommand 用に、UTF-16LEのBase64へ元のスクリプトのまま変換できる", () => {
    const decoded = Buffer.from(encodeScript(LIST_RESUME_IDS_SCRIPT), "base64").toString("utf16le")
    expect(decoded).toBe(LIST_RESUME_IDS_SCRIPT)
  })

  it("実際のPowerShellで実行でき、出力はUUIDの行だけ(Windowsのみ)", async () => {
    if (process.platform !== "win32") return
    const output = await runPowerShellListing()
    for (const line of output.split(/\r?\n/).filter((l) => l.trim())) {
      expect(line.trim()).toMatch(/^[0-9a-fA-F-]{36}$/)
    }
  }, 30_000)
})

describe("CliProcessWatcher", () => {
  function makeWatcher(overrides: { run?: () => Promise<string>; platform?: NodeJS.Platform } = {}) {
    let clock = 1_000_000
    const run = overrides.run ?? vi.fn().mockResolvedValue(`${fakeCliId(1)}\n${fakeCliId(2)}\n`)
    const watcher = new CliProcessWatcher({
      run,
      now: () => clock,
      intervalMs: 30_000,
      platform: overrides.platform ?? "win32",
    })
    return { watcher, run, advance: (ms: number) => (clock += ms) }
  }

  it("最初の peek は待たずに null を返し、取得が終わると結果を返す", async () => {
    const { watcher, run } = makeWatcher()
    expect(watcher.peek()).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
    await watcher.refresh()
    expect([...watcher.peek()!].sort()).toEqual([fakeCliId(1), fakeCliId(2)])
  })

  it("間隔内は読み直さず、間隔を過ぎた peek で読み直しを始める(結果の更新は待たない)", async () => {
    const { watcher, run, advance } = makeWatcher()
    watcher.peek()
    await watcher.refresh()
    advance(10_000)
    watcher.peek()
    expect(run).toHaveBeenCalledTimes(1)
    advance(21_000)
    const stale = watcher.peek()
    expect(run).toHaveBeenCalledTimes(2)
    expect(stale).not.toBeNull() // 読み直しの完了前は、手元の結果をそのまま返す
  })

  it("実行中は多重に起動しない", async () => {
    let resolveRun: (v: string) => void = () => undefined
    const run = vi.fn(() => new Promise<string>((r) => (resolveRun = r)))
    const { watcher, advance } = makeWatcher({ run })
    watcher.peek()
    advance(60_000)
    watcher.peek()
    watcher.peek()
    expect(run).toHaveBeenCalledTimes(1)
    resolveRun(`${fakeCliId(1)}\n`)
    await watcher.refresh()
    expect(watcher.peek()?.has(fakeCliId(1))).toBe(true)
  })

  it("取得に失敗したら、しばらくは前回の結果を使い、古くなったら null(情報なし)に戻す", async () => {
    const run = vi.fn().mockResolvedValueOnce(`${fakeCliId(1)}\n`).mockRejectedValue(new Error("boom"))
    const { watcher, advance } = makeWatcher({ run })
    watcher.peek()
    await watcher.refresh()

    advance(31_000)
    watcher.peek()
    await watcher.refresh()
    expect(watcher.peek()?.has(fakeCliId(1))).toBe(true)

    advance(31_000 * 3)
    expect(watcher.peek()).toBeNull()
  })

  it("最初から失敗し続けても例外を投げず、null のまま", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"))
    const { watcher } = makeWatcher({ run })
    expect(() => watcher.peek()).not.toThrow()
    await watcher.refresh()
    expect(watcher.peek()).toBeNull()
  })

  it("Windows以外では取得せず、常に null", () => {
    const { watcher, run } = makeWatcher({ platform: "linux" })
    expect(watcher.peek()).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })
})

describe("自動の探索を止めているとき（⑧-3）", () => {
  it("CCD_DESKTOP_AUTODETECT=0 なら PowerShell を1回も実行せず、情報なし(null)を返す", async () => {
    const run = vi.fn(async () => `${fakeCliId(1)}\n`)
    const watcher = new CliProcessWatcher({ run, platform: "win32", env: { CCD_DESKTOP_AUTODETECT: "0" } })
    expect(watcher.peek()).toBeNull()
    await watcher.refresh()
    expect(watcher.peek()).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it("スイッチが無ければ今までどおり取得する", async () => {
    const run = vi.fn(async () => `${fakeCliId(1)}\n`)
    const watcher = new CliProcessWatcher({ run, platform: "win32", env: {} })
    await watcher.refresh()
    expect(run).toHaveBeenCalledTimes(1)
    expect(watcher.peek()?.size).toBe(1)
  })
})
