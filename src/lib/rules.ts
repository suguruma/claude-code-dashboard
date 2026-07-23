import { parseClaudeMd, serializeClaudeMd } from "./claudeMdParser"
import { readTextFile, resolveProjectPath, writeTextFile } from "./fileIO"
import { ProjectConfig, Rule } from "./types"

async function readParsed(project: ProjectConfig) {
  const claudeMdPath = resolveProjectPath(project.path, "CLAUDE.md")
  const content = await readTextFile(claudeMdPath, "")
  return { claudeMdPath, ...parseClaudeMd(content) }
}

async function persist(claudeMdPath: string, preamble: string, rules: Rule[]): Promise<void> {
  await writeTextFile(claudeMdPath, serializeClaudeMd(preamble, rules))
}

export async function getRules(project: ProjectConfig): Promise<Rule[]> {
  const { rules } = await readParsed(project)
  return rules
}

export async function createRule(
  project: ProjectConfig,
  input: { category: string; content: string; enabled?: boolean }
): Promise<Rule> {
  const { claudeMdPath, preamble, rules } = await readParsed(project)
  const rule: Rule = {
    id: `sec-${rules.length}`,
    category: input.category,
    content: input.content,
    enabled: input.enabled ?? true,
  }
  rules.push(rule)
  await persist(claudeMdPath, preamble, rules)
  return rule
}

export async function updateRule(
  project: ProjectConfig,
  id: string,
  patch: Partial<Pick<Rule, "category" | "content" | "enabled">>
): Promise<Rule> {
  const { claudeMdPath, preamble, rules } = await readParsed(project)
  const idx = rules.findIndex((r) => r.id === id)
  if (idx === -1) throw new Error("ルールが見つかりません")
  rules[idx] = { ...rules[idx], ...patch }
  await persist(claudeMdPath, preamble, rules)
  return rules[idx]
}

export async function deleteRule(project: ProjectConfig, id: string): Promise<void> {
  const { claudeMdPath, preamble, rules } = await readParsed(project)
  const filtered = rules.filter((r) => r.id !== id)
  await persist(claudeMdPath, preamble, filtered)
}
