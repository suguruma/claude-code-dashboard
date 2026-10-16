import path from "path"
import { parseClaudeMd, serializeClaudeMd } from "./claudeMdParser"
import { backupFile, readTextFile, resolveProjectPath, writeTextFile } from "./fileIO"
import { serializeFrontmatter } from "./frontmatter"
import { listSkills, validateSkillDirName } from "./skills"
import {
  ExportBundle,
  ExportedRule,
  ExportedSkill,
  ImportApplyResult,
  ImportDiffItem,
  ImportDiffResult,
  ProjectConfig,
  Rule,
} from "./types"

const EXPORT_VERSION = 1

export async function buildExportBundle(project: ProjectConfig): Promise<ExportBundle> {
  const claudeMdPath = resolveProjectPath(project.path, "CLAUDE.md")
  const content = await readTextFile(claudeMdPath, "")
  const { rules } = parseClaudeMd(content)
  const skills = await listSkills(project)

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    sourceProjectName: project.name,
    rules: rules.map((r) => ({ category: r.category, content: r.content, enabled: r.enabled })),
    skills: skills.map((s) => ({
      dirName: s.dirName,
      name: s.name,
      description: s.description,
      argumentSchema: s.argumentSchema,
      category: s.category,
      title: s.title,
      targetModel: s.targetModel,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      body: s.body,
    })),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * インポートされたJSONの形式を検証する。アップロード経由の未信頼データのため、
 * 型を満たさないフィールドがあれば例外を投げてAPI層でエラー応答に変換させる。
 */
export function validateBundle(input: unknown): ExportBundle {
  if (!isRecord(input)) {
    throw new Error("エクスポートファイルの形式が不正です")
  }
  if (input.version !== EXPORT_VERSION) {
    throw new Error("対応していないバージョンのエクスポートファイルです")
  }
  if (!Array.isArray(input.rules) || !Array.isArray(input.skills)) {
    throw new Error("エクスポートファイルの形式が不正です")
  }

  const rules: ExportedRule[] = input.rules.map((r) => {
    if (!isRecord(r) || typeof r.category !== "string" || typeof r.content !== "string") {
      throw new Error("ルールの形式が不正です")
    }
    return { category: r.category, content: r.content, enabled: r.enabled !== false }
  })

  const skills: ExportedSkill[] = input.skills.map((s) => {
    if (
      !isRecord(s) ||
      typeof s.dirName !== "string" ||
      typeof s.name !== "string" ||
      typeof s.description !== "string" ||
      typeof s.body !== "string"
    ) {
      throw new Error("スキルの形式が不正です")
    }
    return {
      dirName: s.dirName,
      name: s.name,
      description: s.description,
      argumentSchema: s.argumentSchema,
      category: typeof s.category === "string" ? s.category : undefined,
      title: typeof s.title === "string" ? s.title : undefined,
      targetModel: typeof s.targetModel === "string" ? s.targetModel : undefined,
      createdAt: typeof s.createdAt === "string" ? s.createdAt : undefined,
      updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : undefined,
      body: s.body,
    }
  })

  return {
    version: EXPORT_VERSION,
    exportedAt: typeof input.exportedAt === "string" ? input.exportedAt : new Date().toISOString(),
    sourceProjectName: typeof input.sourceProjectName === "string" ? input.sourceProjectName : "unknown",
    rules,
    skills,
  }
}

function isValidSkillDirName(dirName: string): boolean {
  try {
    validateSkillDirName(dirName)
    return true
  } catch {
    return false
  }
}

export async function computeImportDiff(
  project: ProjectConfig,
  bundle: ExportBundle
): Promise<ImportDiffResult> {
  const claudeMdPath = resolveProjectPath(project.path, "CLAUDE.md")
  const content = await readTextFile(claudeMdPath, "")
  const { rules: currentRules } = parseClaudeMd(content)
  const currentSkills = await listSkills(project)

  const items: ImportDiffItem[] = []

  for (const incoming of bundle.rules) {
    const existing = currentRules.find((r) => r.category === incoming.category)
    if (!existing) {
      items.push({ kind: "rule", key: incoming.category, status: "new", before: null, after: incoming.content })
    } else if (existing.content !== incoming.content || existing.enabled !== incoming.enabled) {
      items.push({
        kind: "rule",
        key: incoming.category,
        status: "changed",
        before: existing.content,
        after: incoming.content,
      })
    } else {
      items.push({
        kind: "rule",
        key: incoming.category,
        status: "unchanged",
        before: existing.content,
        after: incoming.content,
      })
    }
  }

  for (const incoming of bundle.skills) {
    if (!isValidSkillDirName(incoming.dirName)) {
      items.push({ kind: "skill", key: incoming.dirName, status: "invalid", before: null, after: incoming.body })
      continue
    }
    const existing = currentSkills.find((s) => s.dirName === incoming.dirName)
    const categoryAfter = incoming.category ?? null
    const titleAfter = incoming.title ?? null
    const targetModelAfter = incoming.targetModel ?? null
    if (!existing) {
      items.push({
        kind: "skill",
        key: incoming.dirName,
        status: "new",
        before: null,
        after: incoming.body,
        categoryBefore: null,
        categoryAfter,
        titleBefore: null,
        titleAfter,
        targetModelBefore: null,
        targetModelAfter,
      })
    } else {
      const categoryBefore = existing.category ?? null
      const titleBefore = existing.title ?? null
      const targetModelBefore = existing.targetModel ?? null
      const changed =
        existing.body !== incoming.body ||
        existing.description !== incoming.description ||
        categoryBefore !== categoryAfter ||
        titleBefore !== titleAfter ||
        targetModelBefore !== targetModelAfter
      items.push({
        kind: "skill",
        key: incoming.dirName,
        status: changed ? "changed" : "unchanged",
        before: existing.body,
        after: incoming.body,
        categoryBefore,
        categoryAfter,
        titleBefore,
        titleAfter,
        targetModelBefore,
        targetModelAfter,
      })
    }
  }

  return { items }
}

export async function applyImport(
  project: ProjectConfig,
  bundle: ExportBundle,
  selection: { ruleCategories: string[]; skillDirNames: string[] }
): Promise<ImportApplyResult> {
  const backups: string[] = []

  const selectedRules = bundle.rules.filter((r) => selection.ruleCategories.includes(r.category))
  if (selectedRules.length > 0) {
    const claudeMdPath = resolveProjectPath(project.path, "CLAUDE.md")
    const content = await readTextFile(claudeMdPath, "")
    const { preamble, rules: currentRules } = parseClaudeMd(content)

    const backup = await backupFile(claudeMdPath)
    if (backup) backups.push(backup)

    const merged = [...currentRules]
    for (const incoming of selectedRules) {
      const idx = merged.findIndex((r) => r.category === incoming.category)
      const rule: Rule = {
        id: idx === -1 ? `sec-${merged.length}` : merged[idx].id,
        category: incoming.category,
        content: incoming.content,
        enabled: incoming.enabled,
      }
      if (idx === -1) merged.push(rule)
      else merged[idx] = rule
    }
    await writeTextFile(claudeMdPath, serializeClaudeMd(preamble, merged))
  }

  // dirNameの形式検証はパストラバーサル対策のため必須。クライアントの選択有無に関わらず再検証する
  const selectedSkills = bundle.skills.filter(
    (s) => selection.skillDirNames.includes(s.dirName) && isValidSkillDirName(s.dirName)
  )
  for (const incoming of selectedSkills) {
    const filePath = path.join(resolveProjectPath(project.path, "skills"), incoming.dirName, "SKILL.md")
    const backup = await backupFile(filePath)
    if (backup) backups.push(backup)

    const data: Record<string, unknown> = { name: incoming.name, description: incoming.description }
    if (incoming.argumentSchema !== undefined) data["argument-schema"] = incoming.argumentSchema
    if (incoming.category !== undefined) data.category = incoming.category
    if (incoming.title !== undefined) data.title = incoming.title
    if (incoming.targetModel !== undefined) data["target-model"] = incoming.targetModel
    if (incoming.createdAt !== undefined) data.created = incoming.createdAt
    if (incoming.updatedAt !== undefined) data.updated = incoming.updatedAt
    await writeTextFile(filePath, serializeFrontmatter(data, incoming.body))
  }

  return { backups }
}
