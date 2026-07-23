import { Rule } from "./types"

export const DISABLED_MARKER = "<!-- CCD:DISABLED"
export const DISABLED_END_MARKER = "-->"

export interface ParsedClaudeMd {
  preamble: string
  rules: Rule[]
}

function isSectionStart(line: string): boolean {
  return line.startsWith("## ") || line.trim() === DISABLED_MARKER
}

/**
 * CLAUDE.md を `## 見出し` 単位でルールとしてパースする。
 * 見出し以前のテキスト（タイトル等）は preamble として保持し、シリアライズ時に先頭へ戻す。
 * `<!-- CCD:DISABLED ... -->` で囲まれたセクションは無効化ルールとして扱う。
 * id は出現順に振られる一時的な識別子で、次回パース時に振り直される（永続IDではない）。
 */
export function parseClaudeMd(content: string): ParsedClaudeMd {
  const lines = content.split("\n")
  const rules: Rule[] = []
  const preambleLines: string[] = []
  let counter = 0
  let i = 0

  while (i < lines.length && !isSectionStart(lines[i])) {
    preambleLines.push(lines[i])
    i++
  }

  while (i < lines.length) {
    const disabled = lines[i].trim() === DISABLED_MARKER
    if (disabled) i++

    if (i >= lines.length || !lines[i].startsWith("## ")) {
      // 想定外の孤立行（壊れた無効化コメント等）は読み飛ばす
      i++
      continue
    }

    const heading = lines[i].slice(3).trim()
    i++

    const bodyLines: string[] = []
    while (i < lines.length) {
      if (disabled && lines[i].trim() === DISABLED_END_MARKER) {
        i++
        break
      }
      if (!disabled && isSectionStart(lines[i])) {
        break
      }
      bodyLines.push(lines[i])
      i++
    }

    rules.push({
      id: `sec-${counter++}`,
      category: heading,
      content: bodyLines.join("\n").trim(),
      enabled: !disabled,
    })
  }

  return { preamble: preambleLines.join("\n").trim(), rules }
}

/**
 * ルール一覧を CLAUDE.md 本文としてシリアライズする。
 * 見出し間の自由記述（preamble以外）は保持しない前提のシンプルな往復変換。
 */
export function serializeClaudeMd(preamble: string, rules: Rule[]): string {
  const sections = rules.map((rule) => {
    const section = `## ${rule.category}\n${rule.content}`.trim()
    return rule.enabled ? section : `${DISABLED_MARKER}\n${section}\n${DISABLED_END_MARKER}`
  })

  const parts = [preamble.trim(), ...sections].filter((part) => part.length > 0)
  return parts.join("\n\n") + "\n"
}
