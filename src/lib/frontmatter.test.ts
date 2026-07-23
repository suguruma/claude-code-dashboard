import { describe, expect, it } from "vitest"
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter"

describe("parseFrontmatter", () => {
  it("YAML frontmatterと本文を分離する", () => {
    const content = "---\nname: task\ndescription: テストスキル\n---\n\n# 本文\n内容です。\n"
    const { data, body } = parseFrontmatter(content)
    expect(data.name).toBe("task")
    expect(data.description).toBe("テストスキル")
    expect(body).toBe("# 本文\n内容です。\n")
  })

  it("frontmatterが無い場合は本文全体をbodyとして返す", () => {
    const { data, body } = parseFrontmatter("ただの本文です")
    expect(data).toEqual({})
    expect(body).toBe("ただの本文です")
  })

  it("ネストしたYAML(argument-schema等)もパースできる", () => {
    const content = [
      "---",
      "name: task",
      "description: desc",
      "argument-schema:",
      "  type: object",
      "  properties:",
      "    theme:",
      "      type: string",
      "---",
      "",
      "本文",
    ].join("\n")
    const { data } = parseFrontmatter(content)
    expect(data["argument-schema"]).toMatchObject({ type: "object", properties: { theme: { type: "string" } } })
  })
})

describe("serializeFrontmatter", () => {
  it("パース結果を再シリアライズすると意味的に往復する", () => {
    const original = "---\nname: task\ndescription: テストスキル\n---\n\n本文の内容\n"
    const parsed = parseFrontmatter(original)
    const rebuilt = serializeFrontmatter(parsed.data, parsed.body)
    const reparsed = parseFrontmatter(rebuilt)

    expect(reparsed.data).toEqual(parsed.data)
    expect(reparsed.body.trim()).toBe(parsed.body.trim())
  })
})
