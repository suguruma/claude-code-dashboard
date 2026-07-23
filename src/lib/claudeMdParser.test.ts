import { describe, expect, it } from "vitest"
import { parseClaudeMd, serializeClaudeMd } from "./claudeMdParser"

describe("parseClaudeMd", () => {
  it("h2見出し単位でルールに分割し、見出し以前をpreambleとする", () => {
    const md = "# グローバルルール\n\n## 出力形式\n結論ファーストで簡潔に。\n\n## コード品質\n率直に指摘する。\n"
    const { preamble, rules } = parseClaudeMd(md)

    expect(preamble).toBe("# グローバルルール")
    expect(rules).toHaveLength(2)
    expect(rules[0]).toMatchObject({ category: "出力形式", content: "結論ファーストで簡潔に。", enabled: true })
    expect(rules[1]).toMatchObject({ category: "コード品質", content: "率直に指摘する。", enabled: true })
  })

  it("CCD:DISABLEDコメントで囲まれたセクションを無効ルールとして読み込む", () => {
    const md = [
      "## 有効ルール",
      "本文A",
      "",
      "<!-- CCD:DISABLED",
      "## 無効ルール",
      "本文B",
      "-->",
    ].join("\n")

    const { rules } = parseClaudeMd(md)
    expect(rules).toHaveLength(2)
    expect(rules[0]).toMatchObject({ category: "有効ルール", enabled: true })
    expect(rules[1]).toMatchObject({ category: "無効ルール", content: "本文B", enabled: false })
  })

  it("見出しが無い本文はすべてpreambleになる", () => {
    const { preamble, rules } = parseClaudeMd("自由記述のみのファイル")
    expect(preamble).toBe("自由記述のみのファイル")
    expect(rules).toHaveLength(0)
  })
})

describe("serializeClaudeMd", () => {
  it("パース結果を再シリアライズすると意味的に往復する", () => {
    const original = "# グローバルルール\n\n## 出力形式\n結論ファーストで簡潔に。\n\n## コード品質\n率直に指摘する。\n"
    const parsed = parseClaudeMd(original)
    const rebuilt = serializeClaudeMd(parsed.preamble, parsed.rules)
    const reparsed = parseClaudeMd(rebuilt)

    expect(reparsed.preamble).toBe(parsed.preamble)
    expect(reparsed.rules).toEqual(parsed.rules)
  })

  it("enabled:false のルールを CCD:DISABLED コメントで包んで出力する", () => {
    const output = serializeClaudeMd("", [
      { id: "sec-0", category: "無効化テスト", content: "本文", enabled: false },
    ])
    expect(output).toContain("<!-- CCD:DISABLED")
    expect(output).toContain("## 無効化テスト")
    expect(output).toContain("-->")
  })

  it("preambleが空でもルールだけで正しく出力する", () => {
    const output = serializeClaudeMd("", [
      { id: "sec-0", category: "構成", content: "内容", enabled: true },
    ])
    expect(output.startsWith("## 構成")).toBe(true)
  })
})
