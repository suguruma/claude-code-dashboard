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

async function readSkill(project: ProjectConfig, dirName: string): Promise<SkillMeta | null> {
  const filePath = skillMdPath(project, dirName)
  try {
    const content = await fs.readFile(filePath, "utf-8")
    const { data, body } = parseFrontmatter(content)
    return {
      dirName,
      name: typeof data.name === "string" ? data.name : dirName,
      description: typeof data.description === "string" ? data.description : "",
      argumentSchema: data["argument-schema"],
      body: body.trim(),
    }
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return null
    throw new FileIOError(`${dirName}/SKILL.md の読み込みに失敗しました: ${String(err)}`)
  }
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
  input: { dirName: string; description: string; body: string }
): Promise<SkillMeta> {
  validateSkillDirName(input.dirName)
  const existing = await readSkill(project, input.dirName)
  if (existing) throw new Error(`スキル "${input.dirName}" は既に存在します`)

  const content = serializeFrontmatter(
    { name: input.dirName, description: input.description },
    input.body
  )
  await writeTextFile(skillMdPath(project, input.dirName), content)
  return {
    dirName: input.dirName,
    name: input.dirName,
    description: input.description,
    body: input.body.trim(),
  }
}

export async function updateSkill(
  project: ProjectConfig,
  dirName: string,
  patch: { description?: string; body?: string }
): Promise<SkillMeta> {
  const existing = await readSkill(project, dirName)
  if (!existing) throw new Error("スキルが見つかりません")

  const updated: SkillMeta = {
    ...existing,
    description: patch.description ?? existing.description,
    body: patch.body ?? existing.body,
  }
  const data: Record<string, unknown> = { name: updated.name, description: updated.description }
  if (updated.argumentSchema !== undefined) data["argument-schema"] = updated.argumentSchema

  await writeTextFile(skillMdPath(project, dirName), serializeFrontmatter(data, updated.body))
  return updated
}

export async function renameSkill(
  project: ProjectConfig,
  oldDirName: string,
  newDirName: string
): Promise<SkillMeta> {
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

  const updated: SkillMeta = { ...existing, dirName: newDirName, name: newDirName }
  const data: Record<string, unknown> = { name: updated.name, description: updated.description }
  if (updated.argumentSchema !== undefined) data["argument-schema"] = updated.argumentSchema

  await writeTextFile(skillMdPath(project, newDirName), serializeFrontmatter(data, updated.body))
  return updated
}

export async function deleteSkill(project: ProjectConfig, dirName: string): Promise<void> {
  const existing = await readSkill(project, dirName)
  if (!existing) throw new Error("スキルが見つかりません")
  await fs.rm(path.join(skillsDir(project), dirName), { recursive: true, force: true })
}
