import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { browseDirectory, getShortcuts, readFilePreview } from "./dirBrowser"

const cleanupDirs: string[] = []

async function makeTmpDir(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-dirbrowser-test-"))
  cleanupDirs.push(tmpDir)
  return tmpDir
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("browseDirectory", () => {
  it("ディレクトリを先に、それぞれ名前順でソートして返す", async () => {
    const tmpDir = await makeTmpDir()
    await fs.mkdir(path.join(tmpDir, "zeta-dir"))
    await fs.mkdir(path.join(tmpDir, "alpha-dir"))
    await fs.writeFile(path.join(tmpDir, "b-file.txt"), "")
    await fs.writeFile(path.join(tmpDir, "a-file.txt"), "")

    const result = await browseDirectory(tmpDir)
    expect(result.entries.map((e) => e.name)).toEqual([
      "alpha-dir",
      "zeta-dir",
      "a-file.txt",
      "b-file.txt",
    ])
    expect(result.entries.filter((e) => e.type === "directory")).toHaveLength(2)
  })

  it("CLAUDE.md / skills / execution_log.json / settings.json を isNotable としてマークする", async () => {
    const tmpDir = await makeTmpDir()
    await fs.writeFile(path.join(tmpDir, "CLAUDE.md"), "")
    await fs.mkdir(path.join(tmpDir, "skills"))
    await fs.writeFile(path.join(tmpDir, "execution_log.json"), "")
    await fs.writeFile(path.join(tmpDir, "settings.json"), "")
    await fs.writeFile(path.join(tmpDir, "README.md"), "")

    const result = await browseDirectory(tmpDir)
    const notable = result.entries.filter((e) => e.isNotable).map((e) => e.name)
    expect(notable.sort()).toEqual(
      ["CLAUDE.md", "execution_log.json", "settings.json", "skills"].sort()
    )
    expect(result.entries.find((e) => e.name === "README.md")?.isNotable).toBe(false)
  })

  it("parentPathを正しく算出する", async () => {
    const tmpDir = await makeTmpDir()
    const childDir = path.join(tmpDir, "child")
    await fs.mkdir(childDir)

    const result = await browseDirectory(childDir)
    expect(result.parentPath).toBe(path.resolve(tmpDir))
  })

  it("存在しないパスを指定するとエラーになる", async () => {
    await expect(browseDirectory(path.join(os.tmpdir(), "ccd-does-not-exist-xyz"))).rejects.toThrow()
  })

  it("パス未指定の場合はドライブ一覧(Windows)またはルートを返す", async () => {
    const result = await browseDirectory(null)
    expect(result.entries.length).toBeGreaterThan(0)
    expect(result.parentPath).toBeNull()
  })
})

describe("getShortcuts", () => {
  it("ホームディレクトリと~/.claudeへのショートカットを返す", () => {
    const shortcuts = getShortcuts()
    expect(shortcuts.some((s) => s.label === "ホーム")).toBe(true)
    expect(shortcuts.some((s) => s.label === "~/.claude")).toBe(true)
  })
})

describe("readFilePreview", () => {
  it("テキストファイルの内容を読み込む", async () => {
    const tmpDir = await makeTmpDir()
    const filePath = path.join(tmpDir, "CLAUDE.md")
    await fs.writeFile(filePath, "# ルール\n結論を先に書く", "utf-8")

    const result = await readFilePreview(filePath)
    expect(result).toEqual({ content: "# ルール\n結論を先に書く", truncated: false, binary: false })
  })

  it("上限バイト数を超えるファイルはtruncated: trueで先頭のみ返す", async () => {
    const tmpDir = await makeTmpDir()
    const filePath = path.join(tmpDir, "big.txt")
    await fs.writeFile(filePath, "a".repeat(20 * 1024), "utf-8")

    const result = await readFilePreview(filePath)
    expect(result.truncated).toBe(true)
    expect(result.binary).toBe(false)
    expect(result.content.length).toBe(8 * 1024)
  })

  it("nullバイトを含むファイルはbinary: trueとし内容を返さない", async () => {
    const tmpDir = await makeTmpDir()
    const filePath = path.join(tmpDir, "image.png")
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]))

    const result = await readFilePreview(filePath)
    expect(result).toEqual({ content: "", truncated: false, binary: true })
  })

  it("空ファイルはbinary: false・content: \"\"を返す", async () => {
    const tmpDir = await makeTmpDir()
    const filePath = path.join(tmpDir, "empty.txt")
    await fs.writeFile(filePath, "")

    const result = await readFilePreview(filePath)
    expect(result).toEqual({ content: "", truncated: false, binary: false })
  })

  it("ディレクトリを指定するとエラーになる", async () => {
    const tmpDir = await makeTmpDir()
    await expect(readFilePreview(tmpDir)).rejects.toThrow("ファイルではありません")
  })

  it("存在しないパスを指定するとエラーになる", async () => {
    await expect(
      readFilePreview(path.join(os.tmpdir(), "ccd-does-not-exist-xyz.txt"))
    ).rejects.toThrow()
  })
})
