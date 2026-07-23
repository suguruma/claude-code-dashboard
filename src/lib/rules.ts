import { readJsonFile, readTextFile, resolveProjectPath, writeJsonFile, writeTextFile } from "./fileIO"
import { syncClaudeMd } from "./claudeMdSync"
import { ProjectConfig, Rule, RulesFile } from "./types"

const EMPTY_RULES: RulesFile = { rules: [] }

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextRuleId(rules: Rule[]): string {
  let max = 0
  for (const r of rules) {
    const m = /^rule_(\d+)$/.exec(r.id)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `rule_${String(max + 1).padStart(3, "0")}`
}

async function persist(project: ProjectConfig, rulesFile: RulesFile): Promise<void> {
  const rulesPath = resolveProjectPath(project.path, "rules.json")
  const claudeMdPath = resolveProjectPath(project.path, "CLAUDE.md")
  await writeJsonFile(rulesPath, rulesFile)
  const existing = await readTextFile(claudeMdPath, "")
  const synced = syncClaudeMd(existing, rulesFile.rules)
  await writeTextFile(claudeMdPath, synced)
}

export async function getRules(project: ProjectConfig): Promise<RulesFile> {
  const rulesPath = resolveProjectPath(project.path, "rules.json")
  return readJsonFile<RulesFile>(rulesPath, EMPTY_RULES)
}

export async function createRule(
  project: ProjectConfig,
  input: { category: string; content: string; enabled?: boolean }
): Promise<Rule> {
  const rulesFile = await getRules(project)
  const now = todayStr()
  const rule: Rule = {
    id: nextRuleId(rulesFile.rules),
    category: input.category,
    content: input.content,
    enabled: input.enabled ?? true,
    created_at: now,
    updated_at: now,
  }
  rulesFile.rules.push(rule)
  await persist(project, rulesFile)
  return rule
}

export async function updateRule(
  project: ProjectConfig,
  id: string,
  patch: Partial<Pick<Rule, "category" | "content" | "enabled">>
): Promise<Rule> {
  const rulesFile = await getRules(project)
  const idx = rulesFile.rules.findIndex((r) => r.id === id)
  if (idx === -1) throw new Error("ルールが見つかりません")
  rulesFile.rules[idx] = {
    ...rulesFile.rules[idx],
    ...patch,
    updated_at: todayStr(),
  }
  await persist(project, rulesFile)
  return rulesFile.rules[idx]
}

export async function deleteRule(project: ProjectConfig, id: string): Promise<void> {
  const rulesFile = await getRules(project)
  rulesFile.rules = rulesFile.rules.filter((r) => r.id !== id)
  await persist(project, rulesFile)
}
