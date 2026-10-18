import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { backupFile, getAppDataRoot, pruneBackups, resolveProjectPath } from "./fileIO"
import { RETENTION_MAX_COUNT } from "./retention"

const originalCcdDataDir = process.env.CCD_DATA_DIR

afterEach(() => {
  if (originalCcdDataDir === undefined) delete process.env.CCD_DATA_DIR
  else process.env.CCD_DATA_DIR = originalCcdDataDir
})

describe("getAppDataRoot / resolveProjectPath", () => {
  it("CCD_DATA_DIRが未設定なら process.cwd() を基準にする", () => {
    delete process.env.CCD_DATA_DIR
    expect(getAppDataRoot()).toBe(process.cwd())
    expect(resolveProjectPath("./sample-data", "skills")).toBe(
      path.join(process.cwd(), "sample-data", "skills")
    )
  })

  /**
   * Electron配布版では、Next.jsのstandalone server.jsが起動時に無条件で
   * process.chdir(__dirname) を実行しcwdを自身のリソースディレクトリへ書き換えてしまうため、
   * spawn時のcwd指定だけではアプリの実データ配置場所（config/projects.json等）を制御できない。
   * CCD_DATA_DIR環境変数が設定されていれば、それをprocess.cwd()より優先する。
   */
  it("CCD_DATA_DIRが設定されていれば process.cwd() より優先する", () => {
    process.env.CCD_DATA_DIR = "C:\\fake\\user-data"
    expect(getAppDataRoot()).toBe("C:\\fake\\user-data")
    expect(resolveProjectPath("./sample-data", "skills")).toBe(
      path.join("C:\\fake\\user-data", "sample-data", "skills")
    )
  })

  it("絶対パスのprojectRootはCCD_DATA_DIRの影響を受けない", () => {
    process.env.CCD_DATA_DIR = "C:\\fake\\user-data"
    expect(resolveProjectPath("C:\\real\\project", "skills")).toBe(
      path.join("C:\\real\\project", "skills")
    )
  })
})

describe("backupFile / pruneBackups", () => {
  const tmpDirs: string[] = []
  async function tmp(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-fileio-test-"))
    tmpDirs.push(dir)
    return dir
  }
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tmpDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
  })

  it("元のファイルが無ければ何もしない", async () => {
    const dir = await tmp()
    expect(await backupFile(path.join(dir, "none.md"))).toBeNull()
    expect(await fs.readdir(dir)).toEqual([])
  })

  it("<file>.ccd-backup.<epoch> に現在の内容を複製し、元のファイルはそのまま残す", async () => {
    const dir = await tmp()
    const file = path.join(dir, "CLAUDE.md")
    await fs.writeFile(file, "今の内容")
    const backup = await backupFile(file)
    expect(backup).toMatch(/CLAUDE\.md\.ccd-backup\.\d{10,}$/)
    expect(await fs.readFile(backup as string, "utf-8")).toBe("今の内容")
    expect(await fs.readFile(file, "utf-8")).toBe("今の内容")
  })

  it("同じミリ秒に続けて退避しても、別の世代として残る(上書きしない)", async () => {
    const dir = await tmp()
    const file = path.join(dir, "a.json")
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000)
    await fs.writeFile(file, "1")
    const first = await backupFile(file)
    await fs.writeFile(file, "2")
    const second = await backupFile(file)
    expect(first).not.toBe(second)
    expect(await fs.readFile(first as string, "utf-8")).toBe("1")
    expect(await fs.readFile(second as string, "utf-8")).toBe("2")
  })

  it("同じファイルの退避が上限を超えたら、古い世代から削除する(別のファイルの退避には触れない)", async () => {
    const dir = await tmp()
    const file = path.join(dir, "settings.json")
    const other = path.join(dir, "CLAUDE.md")
    await fs.writeFile(file, "now")
    const now = Date.now()
    // 1時間ずつ古くなる退避を、上限より多く用意する(期間内なので、件数だけで整理される)
    const total = RETENTION_MAX_COUNT + 4
    for (let i = 1; i <= total; i++) {
      await fs.writeFile(`${file}.ccd-backup.${now - i * 3_600_000}`, `gen-${i}`)
    }
    await fs.writeFile(`${other}.ccd-backup.${now - 999 * 3_600_000}`, "別ファイルの退避")

    await backupFile(file)

    const names = (await fs.readdir(dir)).filter((n) => n.startsWith("settings.json.ccd-backup."))
    expect(names).toHaveLength(RETENTION_MAX_COUNT)
    // 残っているのは新しい側(今回の退避 + gen-1 以降)で、いちばん古い世代は消えている
    const contents = await Promise.all(names.map((n) => fs.readFile(path.join(dir, n), "utf-8")))
    expect(contents).toContain("now")
    expect(contents).toContain("gen-1")
    expect(contents).not.toContain(`gen-${total}`)
    expect(await fs.readdir(dir)).toContain(`CLAUDE.md.ccd-backup.${now - 999 * 3_600_000}`)
  })

  it("pruneBackups は、数字以外の接尾辞(手で付けた名前)のファイルは対象にしない", async () => {
    const dir = await tmp()
    const file = path.join(dir, "x.json")
    await fs.writeFile(`${file}.ccd-backup.keep-me`, "手書き")
    await fs.writeFile(`${file}.ccd-backup.1000000000000`, "古い")
    expect(await pruneBackups(file, Date.now())).toEqual([])
    expect(await fs.readdir(dir)).toContain("x.json.ccd-backup.keep-me")
  })
})
