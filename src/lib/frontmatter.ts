import * as yaml from "js-yaml"

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export interface ParsedFrontmatter {
  data: Record<string, unknown>
  body: string
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) {
    return { data: {}, body: content }
  }
  const data = (yaml.load(match[1]) as Record<string, unknown>) ?? {}
  return { data, body: match[2].replace(/^\r?\n/, "") }
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  const yamlText = yaml.dump(data, { lineWidth: -1 }).trimEnd()
  return `---\n${yamlText}\n---\n\n${body.trim()}\n`
}
