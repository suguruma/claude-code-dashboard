import { parseClaudeMd, serializeClaudeMd } from "./claudeMdParser"
import { backupFile, readTextFile, resolveProjectPath, writeTextFile } from "./fileIO"
import { ProjectConfig, Rule } from "./types"

async function readParsed(project: ProjectConfig) {
  const claudeMdPath = resolveProjectPath(project.path, "CLAUDE.md")
  const content = await readTextFile(claudeMdPath, "")
  return { claudeMdPath, ...parseClaudeMd(content) }
}

/**
 * CLAUDE.mdへの書き込みはすべてここを通る(追加・編集・有効/無効の切り替え・削除・並べ替え)。
 * 書き換える前に必ず現在の内容を `CLAUDE.md.ccd-backup.<epoch>` として退避し、「設定 & システム情報」の
 * 「バックアップ」から戻せるようにする。退避に失敗したときは、書き込まずにエラーにする。
 */
async function persist(claudeMdPath: string, preamble: string, rules: Rule[]): Promise<void> {
  await backupFile(claudeMdPath)
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

/**
 * ルールIDは読み込みのたびに見出し+出現順で再構築される一時的な識別子のため、
 * orderedIdsは必ず直前のGETで取得したIDをそのまま使うこと。個数が一致しない
 * （IDの過不足がある）場合は、その間に別プロセスがCLAUDE.mdを書き換えた可能性が
 * あるとみなしエラーとする。
 */
export async function reorderRules(project: ProjectConfig, orderedIds: string[]): Promise<Rule[]> {
  const { claudeMdPath, preamble, rules } = await readParsed(project)
  const byId = new Map(rules.map((r) => [r.id, r]))
  const uniqueOrderedIds = new Set(orderedIds)
  if (orderedIds.length !== rules.length || uniqueOrderedIds.size !== rules.length) {
    throw new Error("並び替え対象のルール一覧が現在の内容と一致しません。画面を再読み込みしてください")
  }
  const reordered = orderedIds.map((id) => {
    const rule = byId.get(id)
    if (!rule) throw new Error("並び替え対象のルール一覧が現在の内容と一致しません。画面を再読み込みしてください")
    return rule
  })
  await persist(claudeMdPath, preamble, reordered)
  return reordered
}
