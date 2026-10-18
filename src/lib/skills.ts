import { promises as fs } from "fs"
import path from "path"
import { FileIOError, backupFile, resolveProjectPath, writeTextFile } from "./fileIO"
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter"
import { assertValidModelName } from "./skillArchivePaths"
import { moveSkillToTrash } from "./skillTrash"
import { ProjectConfig, SkillMeta } from "./types"

const VALID_NAME_RE = /^[a-zA-Z0-9_-]+$/

function skillsDir(project: ProjectConfig): string {
  return resolveProjectPath(project.path, "skills")
}

/**
 * 無効化したスキルの退避先。Claude Codeは`skills/`配下を全て有効なスキルとして読み込むため、
 * 「無効化」は実体をこのディレクトリへ移動することで実現する（frontmatterのフラグ等では発火を止められない）。
 */
function disabledSkillsDir(project: ProjectConfig): string {
  return resolveProjectPath(project.path, "skills-disabled")
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** dirNameが`skills/`（有効）と`skills-disabled/`（無効）のどちらに実在するかを特定する */
async function locateSkillDir(
  project: ProjectConfig,
  dirName: string
): Promise<{ dir: string; enabled: boolean } | null> {
  const activeDir = path.join(skillsDir(project), dirName)
  if (await pathExists(path.join(activeDir, "SKILL.md"))) {
    return { dir: activeDir, enabled: true }
  }
  const disabledDir = path.join(disabledSkillsDir(project), dirName)
  if (await pathExists(path.join(disabledDir, "SKILL.md"))) {
    return { dir: disabledDir, enabled: false }
  }
  return null
}

const SUPPORTING_DIRS = ["references", "scripts", "evals"] as const

/**
 * 「Skill設計者の最新プラクティス」が推奨するSkill構造（references/scripts/evals）の
 * 有無を検知する。この可視化のみが目的で、無くても不正なSkillではない。
 */
async function detectSupportingDirs(
  base: string
): Promise<Pick<SkillMeta, "hasReferences" | "hasScripts" | "hasEvals">> {
  const [hasReferences, hasScripts, hasEvals] = await Promise.all(
    SUPPORTING_DIRS.map(async (sub) => {
      try {
        const stat = await fs.stat(path.join(base, sub))
        return stat.isDirectory()
      } catch {
        return false
      }
    })
  )
  return { hasReferences, hasScripts, hasEvals }
}

/**
 * fs.statのbirthtimeを作成日時の代替として使う。writeTextFile/renameSkillは書き込み時に
 * 一時ファイル経由のrenameを行うため、Windows(NTFS)ではbirthtimeが更新のたびにリセットされてしまい
 * 作成日として信頼できない。そのため作成日時は本来frontmatterの`created`に保存した値を正とし、
 * これは既存スキル（`created`が無い、このフィールド追加以前に作られたスキル）向けの一度きりの推定値としてのみ使う。
 */
async function detectCreatedAt(filePath: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(filePath)
    const birth = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime
    return birth.toISOString()
  } catch {
    return undefined
  }
}

/** `updated`が無い既存スキル向けのフォールバック。mtimeは書き込みのたびに正しく更新されるため、そのまま最終更新日時の推定値として使える */
async function detectMtime(filePath: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(filePath)
    return stat.mtime.toISOString()
  } catch {
    return undefined
  }
}

async function readSkillAt(dir: string, dirName: string, enabled: boolean): Promise<SkillMeta | null> {
  const filePath = path.join(dir, "SKILL.md")
  try {
    const content = await fs.readFile(filePath, "utf-8")
    const { data, body } = parseFrontmatter(content)
    const supportingDirs = await detectSupportingDirs(dir)
    const createdAt =
      typeof data.created === "string" ? data.created : await detectCreatedAt(filePath)
    const updatedAt =
      typeof data.updated === "string" ? data.updated : await detectMtime(filePath)
    return {
      dirName,
      name: typeof data.name === "string" ? data.name : dirName,
      description: typeof data.description === "string" ? data.description : "",
      argumentSchema: data["argument-schema"],
      category: typeof data.category === "string" ? data.category : undefined,
      title: typeof data.title === "string" ? data.title : undefined,
      targetModel: typeof data["target-model"] === "string" ? data["target-model"] : undefined,
      body: body.trim(),
      ...supportingDirs,
      createdAt,
      updatedAt,
      enabled,
    }
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return null
    throw new FileIOError(`${dirName}/SKILL.md の読み込みに失敗しました: ${String(err)}`)
  }
}

async function readSkill(project: ProjectConfig, dirName: string): Promise<SkillMeta | null> {
  const located = await locateSkillDir(project, dirName)
  if (!located) return null
  return readSkillAt(located.dir, dirName, located.enabled)
}

function buildFrontmatterData(skill: SkillMeta): Record<string, unknown> {
  const data: Record<string, unknown> = { name: skill.name, description: skill.description }
  if (skill.argumentSchema !== undefined) data["argument-schema"] = skill.argumentSchema
  if (skill.category !== undefined) data.category = skill.category
  if (skill.title !== undefined) data.title = skill.title
  if (skill.targetModel !== undefined) data["target-model"] = skill.targetModel
  if (skill.createdAt !== undefined) data.created = skill.createdAt
  if (skill.updatedAt !== undefined) data.updated = skill.updatedAt
  return data
}

async function listSubdirNames(dir: string): Promise<string[]> {
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true })
    return dirents.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return []
    throw new FileIOError(`ディレクトリの読み込みに失敗しました: ${String(err)}`)
  }
}

export async function listSkills(project: ProjectConfig): Promise<SkillMeta[]> {
  const activeNames = await listSubdirNames(skillsDir(project))
  const disabledNames = await listSubdirNames(disabledSkillsDir(project))
  // 通常は有効・無効のどちらか一方にしか存在しないが、念のため重複時は有効側を優先する
  const allNames = [...activeNames, ...disabledNames.filter((n) => !activeNames.includes(n))]

  const skills = await Promise.all(allNames.map((name) => readSkill(project, name)))
  return skills.filter((s): s is SkillMeta => s !== null)
}

export async function getSkill(project: ProjectConfig, dirName: string): Promise<SkillMeta | null> {
  return readSkill(project, dirName)
}

export function validateSkillDirName(dirName: string): void {
  if (!VALID_NAME_RE.test(dirName)) {
    throw new Error("スキル名は半角英数字・ハイフン・アンダースコアのみ使用できます")
  }
}

export async function createSkill(
  project: ProjectConfig,
  input: {
    dirName: string
    description: string
    body: string
    category?: string
    title?: string
    targetModel?: string
  }
): Promise<SkillMeta> {
  validateSkillDirName(input.dirName)
  if (input.targetModel) assertValidModelName(input.targetModel)
  const existing = await readSkill(project, input.dirName)
  if (existing) throw new Error(`スキル "${input.dirName}" は既に存在します`)

  const now = new Date().toISOString()
  const skill: SkillMeta = {
    dirName: input.dirName,
    name: input.dirName,
    description: input.description,
    category: input.category || undefined,
    title: input.title || undefined,
    targetModel: input.targetModel || undefined,
    body: input.body.trim(),
    createdAt: now,
    updatedAt: now,
    enabled: true,
  }
  await writeTextFile(
    path.join(skillsDir(project), input.dirName, "SKILL.md"),
    serializeFrontmatter(buildFrontmatterData(skill), skill.body)
  )
  return skill
}

export async function updateSkill(
  project: ProjectConfig,
  dirName: string,
  patch: {
    description?: string
    body?: string
    category?: string
    title?: string
    targetModel?: string
  }
): Promise<SkillMeta> {
  validateSkillDirName(dirName)
  if (patch.targetModel) assertValidModelName(patch.targetModel)
  const located = await locateSkillDir(project, dirName)
  if (!located) throw new Error("スキルが見つかりません")
  const existing = await readSkillAt(located.dir, dirName, located.enabled)
  if (!existing) throw new Error("スキルが見つかりません")

  const updated: SkillMeta = {
    ...existing,
    description: patch.description ?? existing.description,
    body: patch.body ?? existing.body,
    // 空文字は「未分類/未設定に戻す」明示的な指定として扱う(キー自体が無い場合のみ既存値を維持する)
    category: patch.category !== undefined ? patch.category || undefined : existing.category,
    title: patch.title !== undefined ? patch.title || undefined : existing.title,
    targetModel:
      patch.targetModel !== undefined ? patch.targetModel || undefined : existing.targetModel,
    updatedAt: new Date().toISOString(),
  }

  // 書き換える前に、今の SKILL.md を `SKILL.md.ccd-backup.<epoch>` として退避する(設定画面のバックアップから戻せる)。
  // 退避に失敗したときは例外になり、SKILL.md は書き換えない
  const skillMdPath = path.join(located.dir, "SKILL.md")
  await backupFile(skillMdPath)
  await writeTextFile(skillMdPath, serializeFrontmatter(buildFrontmatterData(updated), updated.body))
  return updated
}

export async function renameSkill(
  project: ProjectConfig,
  oldDirName: string,
  newDirName: string
): Promise<SkillMeta> {
  validateSkillDirName(oldDirName)
  if (oldDirName === newDirName) {
    const existing = await readSkill(project, oldDirName)
    if (!existing) throw new Error("スキルが見つかりません")
    return existing
  }

  validateSkillDirName(newDirName)
  const located = await locateSkillDir(project, oldDirName)
  if (!located) throw new Error("スキルが見つかりません")
  const existing = await readSkillAt(located.dir, oldDirName, located.enabled)
  if (!existing) throw new Error("スキルが見つかりません")
  const conflict = await readSkill(project, newDirName)
  if (conflict) throw new Error(`スキル "${newDirName}" は既に存在します`)

  // 書き換える前に、今の SKILL.md を退避する。フォルダ名を変える前に作るので、退避ファイルはフォルダごと新しい名前へ移る。
  // 退避に失敗したときは例外になり、フォルダ名も SKILL.md も変えない
  await backupFile(path.join(located.dir, "SKILL.md"))

  // リネームは有効/無効の状態を変えない(元と同じツリー内で移動する)
  const newPath = path.join(path.dirname(located.dir), newDirName)
  await fs.rename(located.dir, newPath)

  const updated: SkillMeta = {
    ...existing,
    dirName: newDirName,
    name: newDirName,
    updatedAt: new Date().toISOString(),
  }

  await writeTextFile(
    path.join(newPath, "SKILL.md"),
    serializeFrontmatter(buildFrontmatterData(updated), updated.body)
  )
  return updated
}

/**
 * スキルを削除する。完全削除はせず、`skills-trash/<名前>-<日時>/` へ移す(`skills/` の外なので、
 * Claude Codeからは呼び出せなくなる)。画面の「削除済みスキル」から復元できる。
 */
export async function deleteSkill(project: ProjectConfig, dirName: string): Promise<void> {
  validateSkillDirName(dirName)
  const located = await locateSkillDir(project, dirName)
  if (!located) throw new Error("スキルが見つかりません")
  await moveSkillToTrash(project, dirName, located.dir, located.enabled)
}

/** スキルを`skills/`から`skills-disabled/`へ移動し、Claude Codeに読み込まれないようにする */
export async function disableSkill(project: ProjectConfig, dirName: string): Promise<SkillMeta> {
  validateSkillDirName(dirName)
  const located = await locateSkillDir(project, dirName)
  if (!located) throw new Error("スキルが見つかりません")
  if (!located.enabled) throw new Error("既に無効化されています")

  const destDir = disabledSkillsDir(project)
  await fs.mkdir(destDir, { recursive: true })
  const destPath = path.join(destDir, dirName)
  await fs.rename(located.dir, destPath)

  const skill = await readSkillAt(destPath, dirName, false)
  if (!skill) throw new Error("無効化後にスキルの読み込みに失敗しました")
  return skill
}

/** スキルを`skills-disabled/`から`skills/`へ戻し、再びClaude Codeに読み込まれるようにする */
export async function enableSkill(project: ProjectConfig, dirName: string): Promise<SkillMeta> {
  validateSkillDirName(dirName)
  const located = await locateSkillDir(project, dirName)
  if (!located) throw new Error("スキルが見つかりません")
  if (located.enabled) throw new Error("既に有効化されています")

  const destDir = skillsDir(project)
  await fs.mkdir(destDir, { recursive: true })
  const destPath = path.join(destDir, dirName)
  await fs.rename(located.dir, destPath)

  const skill = await readSkillAt(destPath, dirName, true)
  if (!skill) throw new Error("有効化後にスキルの読み込みに失敗しました")
  return skill
}
