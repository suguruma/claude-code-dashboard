import { describe, expect, it } from "vitest"
import { MEMBER_ORDERS, normalizeMemberOrder, orderMembers } from "./flowOrder"

const title = (s: { title: string }) => s.title
const s = (name: string, id = name) => ({ title: name, id })
const names = (list: Array<{ title: string }>) => list.map((x) => x.title)

describe("orderMembers: 名前順", () => {
  it("01_ 02_ 03_ の順に並ぶ。作成順がばらばらでも番号どおり", () => {
    const created = [s("03_検証"), s("01_画面の修正"), s("04_文書の整備"), s("02_集計の作成")]
    expect(names(orderMembers(created, "name", title))).toEqual(["01_画面の修正", "02_集計の作成", "03_検証", "04_文書の整備"])
  })

  it("数字の並びは数として比べる。2_ は 10_ より先（文字として比べると 10_ が先になる）", () => {
    expect(names(orderMembers([s("10_j"), s("2_b"), s("1_a"), s("100_z")], "name", title))).toEqual(["1_a", "2_b", "10_j", "100_z"])
    expect(names(orderMembers([s("a10"), s("a9"), s("a1")], "name", title))).toEqual(["a1", "a9", "a10"])
  })

  it("大文字・小文字、全角と半角の数字を区別しない", () => {
    expect(names(orderMembers([s("b"), s("A"), s("c")], "name", title))).toEqual(["A", "b", "c"])
    expect(names(orderMembers([s("10_a"), s("９_b"), s("1_c")], "name", title))).toEqual(["1_c", "９_b", "10_a"])
  })

  it("名前が同じなら、渡された順（作成順）のまま。元の配列は変えない", () => {
    const created = [s("02_x", "first"), s("01_y", "second"), s("02_x", "third")]
    const ordered = orderMembers(created, "name", title)
    expect(ordered.map((x) => x.id)).toEqual(["second", "first", "third"])
    expect(created.map((x) => x.id)).toEqual(["first", "second", "third"])
  })

  it("番号の無い名前は、番号付きの後ろ（記号・数字が文字より先）。空の名前も例外にしない", () => {
    expect(names(orderMembers([s("調査"), s("02_b"), s("01_a"), s("")], "name", title))).toEqual(["", "01_a", "02_b", "調査"])
  })
})

describe("orderMembers: 作成順", () => {
  it("並べ替えず、渡された順（サーバーが返す作成順）のまま。新しい配列を返す", () => {
    const created = [s("03_検証"), s("01_画面の修正"), s("02_集計の作成")]
    const ordered = orderMembers(created, "created", title)
    expect(names(ordered)).toEqual(["03_検証", "01_画面の修正", "02_集計の作成"])
    expect(ordered).not.toBe(created)
  })
})

describe("normalizeMemberOrder", () => {
  it("保存された値が created のときだけ作成順。未設定・未知の値は名前順", () => {
    expect(normalizeMemberOrder("created")).toBe("created")
    expect(normalizeMemberOrder("name")).toBe("name")
    for (const bad of [undefined, null, "", "other", 1]) expect(normalizeMemberOrder(bad)).toBe("name")
    expect(MEMBER_ORDERS.map((o) => o.value)).toEqual(["name", "created"])
  })
})
