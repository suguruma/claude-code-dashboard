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

  it("3層目のカードへは、親のカードの下から、左寄りの縦線で下ろして、カードの横から入れる。2層目の線は変わらない", () => {
    const withSubs = [
      ...members,
      { id: "a1", rect: rect(16, 190, 84, 60), parentId: "a" }, // a の下(a の下端は 180)
      { id: "a2", rect: rect(16, 266, 84, 20), parentId: "a" }, // 低いカード: 入れる高さはカードの半分
    ]
    const wires = wirePaths({ leader, members: withSubs, external: null, columnGap: 20, rowGap: 30 })
    // a の左端 0 + 字下げ 12 の縦線を、a の下端 180 から、カードの上端から22下 (212) まで下ろし、カードの左端 16 へ
    expect(wires.members.a1).toBe("M12,180 V212 H16")
    expect(wires.members.a2).toBe("M12,180 V276 H16")
    // 2層目の線は、3層目があっても変わらない(母線の高さは、2層目の1行目の上端だけで決める)
    const plain = wirePaths({ leader, members, external: null, columnGap: 20, rowGap: 30 })
    for (const id of ["a", "b", "c"]) expect(wires.members[id]).toBe(plain.members[id])
  })

  it("親が members に無い3層目は、指揮役の子として扱う", () => {
    const wires = wirePaths({ leader, members: [{ id: "x", rect: rect(0, 120), parentId: "unknown" }], external: null, columnGap: 20, rowGap: 30 })
    expect(wires.members.x).toBe("M300,80 V100 H50 V120")
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
