import { describe, expect, it } from "vitest"
import { syntheticMap } from "./envMapFixtures"
import { isProblem, maskUserPath, normalizePath, parseJstTime, parseMap, type ParsedMap } from "./mapData"

const HOME = "C:\\Users\\tester"
const NOW = Date.UTC(2026, 10, 18, 3, 0) // 11/18 12:00 日本時間

const parsed = (raw: unknown): ParsedMap => {
  const r = parseMap(raw, HOME, NOW)
  if (isProblem(r)) throw new Error(r.message)
  return r
}

describe("[A1] 地図の変換", () => {
  it("7層・ghost を除く94箱・線69、食い違いの線に印", () => {
    const { data } = parsed(syntheticMap())
    expect(data.layers).toHaveLength(7)
    expect(data.nodes).toHaveLength(94)
    expect(data.edges).toHaveLength(69)
    expect(data.edges.filter((e) => e.conflict)).toHaveLength(1)
    expect(data.nodes.some((n) => n.id === "entry:n98")).toBe(false)
    expect(data.schema).toBe(1)
  })

  it("両端の片方が ghost・無い箱の線は落とす。つながりの数を数える", () => {
    const raw = syntheticMap()
    ;(raw.edges as Record<string, unknown>[]).push({ src: "entry:n0", dst: "entry:n98", kind: "mention" }, { src: "x", dst: "entry:n0" })
    const { data } = parsed(raw)
    expect(data.edges).toHaveLength(69)
    expect(data.nodes.find((n) => n.id === "entry:n0")?.degree).toBe(1)
    expect(data.nodes.find((n) => n.id === "safety:n1")?.degree).toBe(2)
  })
})

describe("[A4] 形の版と形の違い", () => {
  it("schema 2 以上は描かない", () => {
    const r = parseMap(syntheticMap({ schema: 2 }), HOME, NOW)
    expect(isProblem(r) && r.kind).toBe("newer-schema")
    expect(isProblem(r) && r.message).toContain("Dashboard の更新が要ります")
  })
  it("nodes が無い・layers が配列でない、はそれぞれの文", () => {
    const a = parseMap({ ...syntheticMap(), nodes: undefined }, HOME, NOW)
    const b = parseMap({ ...syntheticMap(), layers: {} }, HOME, NOW)
    expect(isProblem(a) && a.message).toContain("箱の一覧がありません")
    expect(isProblem(b) && b.message).toContain("層の一覧がありません")
    expect(isProblem(parseMap([], HOME, NOW))).toBe(true)
  })
  it("schema の無い 11/14 の形も描ける", () => {
    const raw = syntheticMap()
    delete (raw as Record<string, unknown>).schema
    expect(parsed(raw).data.schema).toBeNull()
  })
})

describe("[A27] 地図の古さ", () => {
  it("作成から7日を超えたら stale", () => {
    expect(parsed(syntheticMap({ generated_at: "2026-11-10 09:00" })).data.stale).toBe(true)
    expect(parsed(syntheticMap()).data.stale).toBe(false)
  })
  it("generated_at は日本時間として読む", () => {
    expect(parseJstTime("2026-11-18 09:41")).toBe(Date.UTC(2026, 10, 18, 0, 41))
    expect(parseJstTime("not a date")).toBeNull()
  })
})

describe("[6章] 個人のフォルダの名前を伏せる", () => {
  it("C:\\Users\\<名前> と /home/<名前> を ~ に", () => {
    expect(maskUserPath("C:\\Users\\someone\\work")).toBe("~\\work")
    expect(maskUserPath("c:/users/someone/x")).toBe("~/x")
    expect(maskUserPath("/home/someone/.claude")).toBe("~/.claude")
  })
  it("place・desc・label・id・線の両端も伏せる", () => {
    const raw = syntheticMap()
    const nodes = raw.nodes as Record<string, unknown>[]
    nodes[0] = { ...nodes[0], id: "rule:C:\\Users\\someone\\CLAUDE.md", label: "C:\\Users\\someone", place: "C:\\Users\\someone\\a", desc: "/home/someone/b" }
    ;(raw.edges as Record<string, unknown>[])[0].src = "rule:C:\\Users\\someone\\CLAUDE.md"
    const text = JSON.stringify(parsed(raw).data)
    expect(text).not.toContain("someone")
  })
})

describe("[A5c] パスの正規化", () => {
  it("~ を戻し、区切りと大文字小文字をそろえる。WSL は比べない", () => {
    expect(normalizePath("~\\AIxDev\\", HOME)).toBe("c:\\users\\tester\\aixdev")
    expect(normalizePath("C:/AIxDev/X", HOME)).toBe("c:\\aixdev\\x")
    expect(normalizePath("WSL ~/work", HOME)).toBeNull()
    expect(normalizePath("relative\\path", HOME)).toBeNull()
  })
})
