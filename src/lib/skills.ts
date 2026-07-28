import { promises as fs } from "fs"
import path from "path"
import { FileIOError, resolveProjectPath, writeTextFile } from "./fileIO"
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter"
import { ProjectConfig, SkillMeta } from "./types"

const VALID_NAME_RE = /^[a-zA-Z0-9_-]+$/

function skillsDir(project: ProjectConfig): string {
  return resolveProjectPath(project.path, "skills")
}

function skillMdPath(project: ProjectConfig, dirName: string): string {
  return path.join(skillsDir(project), dirName, "SKILL.md")
}

const SUPPORTING_DIRS = ["references", "scripts", "evals"] as const

/**
 * 「Skill設計者の最新プラクティス」が推奨するSkill構造（references/scripts/evals）の
 * 有無を検知する。この可視化のみが目的で、無くても不正なSkillではない。
 */
async function detectSupportingDirs(
  project: ProjectConfig,
  dirName: string
): Promise<Pick<SkillMeta, "hasReferences" | "hasScripts" | "hasEvals">> {
  const base = path.join(skillsDir(project), dirName)
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

async function readSkill(project: ProjectConfig, dirName: string): Promise<SkillMeta | null> {
  const filePath = skillMdPath(project, dirName)
  try {
    const content = await fs.readFile(filePath, "utf-8")
    const { data, body } = parseFrontmatter(content)
    const supportingDirs = await detectSupportingDirs(project, dirName)
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
    }
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return null
    throw new FileIOError(`${dirName}/SKILL.md の読み込みに失敗しました: ${String(err)}`)
  }
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

export async function listSkills(project: ProjectConfig): Promise<SkillMeta[]> {
  const dir = skillsDir(project)
  let dirNames: string[]
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true })
    dirNames = dirents.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return []
    throw new FileIOError(`skills ディレクトリの読み込みに失敗しました: ${String(err)}`)
  }

  const skills = await Promise.all(dirNames.map((name) => readSkill(project, name)))
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
  }
  await writeTextFile(
    skillMdPath(project, input.dirName),
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
  const existing = await readSkill(project, dirName)
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

  await writeTextFile(
    skillMdPath(project, dirName),
    serializeFrontmatter(buildFrontmatterData(updated), updated.body)
  )
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
  const existing = await readSkill(project, oldDirName)
  if (!existing) throw new Error("スキルが見つかりません")
  const conflict = await readSkill(project, newDirName)
  if (conflict) throw new Error(`スキル "${newDirName}" は既に存在します`)

  await fs.rename(
    path.join(skillsDir(project), oldDirName),
    path.join(skillsDir(project), newDirName)
  )

  const updated: SkillMeta = {
    ...existing,
    dirName: newDirName,
    name: newDirName,
    updatedAt: new Date().toISOString(),
  }

  await writeTextFile(
    skillMdPath(project, newDirName),
    serializeFrontmatter(buildFrontmatterData(updated), updated.body)
  )
  return updated
}

export async function deleteSkill(project: ProjectConfig, dirName: string): Promise<void> {
  validateSkillDirName(dirName)
  const existing = await readSkill(project, dirName)
  if (!existing) throw new Error("スキルが見つかりません")
  await fs.rm(path.join(skillsDir(project), dirName), { recursive: true, force: true })
}
