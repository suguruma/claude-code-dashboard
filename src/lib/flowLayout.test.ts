import { describe, expect, it } from "vitest"
import { wirePaths, type Rect } from "./flowLayout"

const rect = (left: number, top: number, width = 100, height = 60): Rect => ({ left, top, width, height })

describe("wirePaths", () => {
  const leader = rect(200, 0, 200, 80) // 下端 80、中心 x=300
  const members = [
    { id: "a", rect: rect(0, 120) },
    { id: "b", rect: rect(150, 122) }, // 1行目（上端の差が4px未満）
    { id: "c", rect: rect(0, 220) }, // 2行目
  ]

  it("1行目の子へは、指揮役の下から母線を引いて、子の上へ降りる", () => {
    const wires = wirePaths({ leader, members, external: null, columnGap: 20, rowGap: 30 })
    // 母線の高さは、指揮役の下端(80)と1行目の上端(120)の中間
    expect(wires.members.a).toBe("M300,80 V100 H50 V120")
    expect(wires.members.b).toBe("M300,80 V100 H200 V122")
  })

  it("2行目以降の子へは、列の間と行の間を通して、カードに重ならない経路にする", () => {
    const wires = wirePaths({ leader, members, external: null, columnGap: 20, rowGap: 30 })
    expect(wires.members.c).toBe("M300,80 V100 H-10 V205 H50 V220")
  })

  it("子がいなければ線は無い。「他のグループ・外部」は、指揮役の横に置けるなら横から、狭ければ下から縦に引く", () => {
    expect(wirePaths({ leader, members: [], external: null, columnGap: 0, rowGap: 0 })).toEqual({ members: {}, external: null })
    const side = wirePaths({ leader, members: [], external: rect(430, 10, 80, 20), columnGap: 0, rowGap: 0 })
    expect(side.external).toBe("M430,20 H400")
    const narrow = wirePaths({ leader, members: [], external: rect(250, -30, 80, 20), columnGap: 0, rowGap: 0 })
    expect(narrow.external).toBe("M290,-10 V0")
    // カードに重なって隙間が無ければ、線は引かない
    const overlap = wirePaths({ leader, members: [], external: rect(250, 10, 80, 20), columnGap: 0, rowGap: 0 })
    expect(overlap.external).toBeNull()
  })
})
