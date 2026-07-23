import { Rule } from "./types"

export const RULES_BLOCK_START =
  "<!-- CCD:RULES:START (このブロックは Claude Code Dashboard が自動生成します。直接編集しないでください) -->"
export const RULES_BLOCK_END = "<!-- CCD:RULES:END -->"

function buildRulesBlock(rules: Rule[]): string {
  const enabledRules = rules.filter((r) => r.enabled)
  const byCategory = new Map<string, Rule[]>()
  for (const rule of enabledRules) {
    const list = byCategory.get(rule.category) ?? []
    list.push(rule)
    byCategory.set(rule.category, list)
  }

  const lines: string[] = [RULES_BLOCK_START, "", "# ルール（Claude Code Dashboard 管理）", ""]
  for (const [category, categoryRules] of byCategory) {
    lines.push(`## ${category}`)
    for (const rule of categoryRules) {
      lines.push(`- ${rule.content} (${rule.id})`)
    }
    lines.push("")
  }
  lines.push(RULES_BLOCK_END)
  return lines.join("\n")
}

export function syncClaudeMd(existingContent: string, rules: Rule[]): string {
  const block = buildRulesBlock(rules)
  const startIdx = existingContent.indexOf(RULES_BLOCK_START)
  const endIdx = existingContent.indexOf(RULES_BLOCK_END)

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return (
      existingContent.slice(0, startIdx) +
      block +
      existingContent.slice(endIdx + RULES_BLOCK_END.length)
    )
  }

  const trimmed = existingContent.trimEnd()
  const separator = trimmed.length > 0 ? "\n\n" : ""
  return trimmed + separator + block + "\n"
}
