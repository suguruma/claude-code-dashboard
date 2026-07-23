import { describe, expect, it } from "vitest"
import { syncClaudeMd, RULES_BLOCK_START, RULES_BLOCK_END } from "./claudeMdSync"
import { Rule } from "./types"

function makeRule(overrides: Partial<Rule>): Rule {
  return {
    id: "rule_001",
    category: "構成",
    content: "テストルール",
    enabled: true,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  }
}

describe("syncClaudeMd", () => {
  it("マーカーが存在しない場合は末尾に自動生成ブロックを追記する", () => {
    const existing = "# 手動で書いたメモ\n\nここはユーザーの自由記述領域。"
    const result = syncClaudeMd(existing, [makeRule({})])

    expect(result).toContain("ここはユーザーの自由記述領域。")
    expect(result).toContain(RULES_BLOCK_START)
    expect(result).toContain(RULES_BLOCK_END)
    expect(result).toContain("テストルール")
  })

  it("既存のブロックを置換し、前後の手動記述は保持する", () => {
    const oldBlock = [
      RULES_BLOCK_START,
      "# ルール（Claude Code Dashboard 管理）",
      "## 旧カテゴリ",
      "- 古いルール (rule_old)",
      RULES_BLOCK_END,
    ].join("\n")
    const existing = `冒頭メモ\n\n${oldBlock}\n\n末尾メモ`

    const result = syncClaudeMd(existing, [makeRule({ content: "新しいルール" })])

    expect(result).toContain("冒頭メモ")
    expect(result).toContain("末尾メモ")
    expect(result).toContain("新しいルール")
    expect(result).not.toContain("古いルール")
  })

  it("無効化(enabled: false)なルールはブロックに含めない", () => {
    const rules = [
      makeRule({ id: "rule_001", content: "有効なルール", enabled: true }),
      makeRule({ id: "rule_002", content: "無効なルール", enabled: false }),
    ]
    const result = syncClaudeMd("", rules)

    expect(result).toContain("有効なルール")
    expect(result).not.toContain("無効なルール")
  })

  it("カテゴリごとに見出しを分けて出力する", () => {
    const rules = [
      makeRule({ id: "rule_001", category: "構成", content: "構成ルール" }),
      makeRule({ id: "rule_002", category: "トーン", content: "トーンルール" }),
    ]
    const result = syncClaudeMd("", rules)

    expect(result).toContain("## 構成")
    expect(result).toContain("## トーン")
  })
})
