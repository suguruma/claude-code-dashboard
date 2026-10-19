import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { applyImport, buildExportBundle } from "./exportImport"
import { MIGRATE_EXCLUDED, MIGRATE_IMPORT_NOTE, MIGRATE_INCLUDED } from "./migrateScope"
import { ProjectConfig } from "./types"

// 移行のページの「移るもの・移らないもの」の説明が、エクスポート・インポートの実際の動きと合っていることを確かめる
const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-migrate-scope-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "テストプロジェクト", path: tmpDir }
}

async function writeSkill(root: string, dirName: string, body: string) {
  const dir = path.join(root, dirName)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${dirName}\ndescription: desc\n---\n\n${body}\n`)
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("移行で移るもの・移らないもの", () => {
  it("書き出すのはルールとスキルだけ（形式を変えたら、migrateScope.ts の説明も直す）", async () => {
    const project = await makeProject()
    const bundle = await buildExportBundle(project)
    expect(Object.keys(bundle).sort()).toEqual(["exportedAt", "rules", "skills", "sourceProjectName", "version"])
    expect(MIGRATE_INCLUDED).toHaveLength(2)
    expect(MIGRATE_EXCLUDED.length).toBeGreaterThan(0)
  })

  it("最初の見出しより前の文と、スキルのフォルダのほかのファイルは移らない。無効のスキルは有効として入る", async () => {
    const source = await makeProject()
    await fs.writeFile(path.join(source.path, "CLAUDE.md"), "前置きの文\n\n## ルールA\n本文A\n")
    await writeSkill(path.join(source.path, "skills"), "on-skill", "有効の本文")
    await fs.writeFile(path.join(source.path, "skills", "on-skill", "helper.txt"), "ほかのファイル")
    await writeSkill(path.join(source.path, "skills-disabled"), "off-skill", "無効の本文")

    const bundle = await buildExportBundle(source)
    expect(JSON.stringify(bundle)).not.toContain("前置きの文")
    expect(JSON.stringify(bundle)).not.toContain("ほかのファイル")
    expect(bundle.skills.map((s) => s.dirName).sort()).toEqual(["off-skill", "on-skill"])

    const target = await makeProject()
    await applyImport(target, bundle, { ruleCategories: ["ルールA"], skillDirNames: ["on-skill", "off-skill"] })
    await fs.access(path.join(target.path, "skills", "off-skill", "SKILL.md"))
    await expect(fs.access(path.join(target.path, "skills-disabled", "off-skill"))).rejects.toThrow()
    await expect(fs.access(path.join(target.path, "skills", "on-skill", "helper.txt"))).rejects.toThrow()
  })

  it("インポートは足す・上書きするだけで、今あるルール・スキル・前置きの文は消さない", async () => {
    const source = await makeProject()
    await fs.writeFile(path.join(source.path, "CLAUDE.md"), "## ルールA\n新しい本文A\n")
    const bundle = await buildExportBundle(source)

    const target = await makeProject()
    await fs.writeFile(path.join(target.path, "CLAUDE.md"), "取り込む側の前置き\n\n## ルールA\n古い本文A\n\n## ルールB\n本文B\n")
    await writeSkill(path.join(target.path, "skills"), "keep-skill", "残る本文")

    await applyImport(target, bundle, { ruleCategories: ["ルールA"], skillDirNames: [] })
    const claudeMd = await fs.readFile(path.join(target.path, "CLAUDE.md"), "utf-8")
    expect(claudeMd).toContain("取り込む側の前置き")
    expect(claudeMd).toContain("新しい本文A")
    expect(claudeMd).not.toContain("古い本文A")
    expect(claudeMd).toContain("## ルールB")
    await fs.access(path.join(target.path, "skills", "keep-skill", "SKILL.md"))
    expect(MIGRATE_IMPORT_NOTE).toContain("消しません")
  })
})
