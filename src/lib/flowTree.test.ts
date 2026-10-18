import { describe, expect, it } from "vitest"
import { arrangeTree, memberDepth, placeOrgTree, type TreePlacement, type TreeSession } from "./flowTree"

const LEADER = "L"

/** 候補を作る。createdAt は省略すると、作った順(古い順)になる */
function make() {
  let n = 0
  return (id: string, parentId: string | null, inGroup: boolean, createdAt: number | null = ++n * 1000): TreeSession => ({
    id,
    createdAt,
    parentId,
    inGroup,
  })
}

const placed = (list: TreePlacement[]) => Object.fromEntries(list.map((p) => [p.id, [p.depth, p.parentId]]))

describe("placeOrgTree: 木の規則", () => {
  it("グループ内の子は2層目(親が指揮役・親が無い・親が木に無い、のどれでも)。親が指揮役なら、グループの外でも2層目", () => {
    const s = make()
    const result = placeOrgTree({
      leaderId: LEADER,
      sessions: [
        s("a", LEADER, true),
        s("b", null, true),
        s("c", "unknown-session", true),
        s("d", "other-group-member", true), // 別のグループのセッションが親: 木に無い
        s("outer", LEADER, false), // グループ外でも、親が指揮役なら2層目
      ],
    })
    expect(placed(result)).toEqual({
      a: [2, LEADER],
      b: [2, LEADER],
      c: [2, LEADER],
      d: [2, LEADER],
      outer: [2, LEADER],
    })
  })

  it("親がグループ内の別の子なら、その子の3層目。グループ外のセッションも、親が2層目の子なら3層目に出る", () => {
    const s = make()
    const result = placed(
      placeOrgTree({
        leaderId: LEADER,
        sessions: [s("a", LEADER, true), s("b", LEADER, true), s("in-group-sub", "a", true), s("coach", "a", false), s("side", "b", false)],
      })
    )
    expect(result).toEqual({
      a: [2, LEADER],
      b: [2, LEADER],
      "in-group-sub": [3, "a"],
      coach: [3, "a"],
      side: [3, "b"],
    })
  })

  it("グループ外のセッションは、親が木に無いなら出さない(親が無い・親が見つからない・親もグループ外で木に着かない)", () => {
    const s = make()
    const result = placed(
      placeOrgTree({
        leaderId: LEADER,
        sessions: [
          s("a", LEADER, true),
          s("no-parent", null, false),
          s("lost", "unknown-session", false),
          s("floating-parent", null, false),
          s("child-of-floating", "floating-parent", false),
        ],
      })
    )
    expect(result).toEqual({ a: [2, LEADER] })
  })

  it("4層目以降は、2層目の祖先の3層目にまとめる(グループ外の連鎖も同じ)", () => {
    const s = make()
    const result = placed(
      placeOrgTree({
        leaderId: LEADER,
        sessions: [
          s("a", LEADER, true),
          s("third", "a", false),
          s("fourth", "third", false),
          s("fifth", "fourth", false),
          s("in-group-fourth", "third", true),
        ],
      })
    )
    expect(result).toEqual({
      a: [2, LEADER],
      third: [3, "a"],
      fourth: [3, "a"],
      fifth: [3, "a"],
      "in-group-fourth": [3, "a"],
    })
  })

  it("グループ内のセッションの親が、グループ外のセッションなら、その親が木に無い限り2層目。木に着くなら、その3層目", () => {
    const s = make()
    const detached = placed(placeOrgTree({ leaderId: LEADER, sessions: [s("g", "outer", true), s("outer", null, false)] }))
    expect(detached).toEqual({ g: [2, LEADER] })

    const attached = placed(
      placeOrgTree({ leaderId: LEADER, sessions: [s("a", LEADER, true), s("outer", "a", false), s("g", "outer", true)] })
    )
    expect(attached).toEqual({ a: [2, LEADER], outer: [3, "a"], g: [3, "a"] })
  })

  it("親の連鎖が輪になっていても止まり、輪の中で最も古いセッションが2層目、ほかはその3層目になる", () => {
    const s = make()
    // 2つの輪(a と b)。a のほうが古い
    expect(placed(placeOrgTree({ leaderId: LEADER, sessions: [s("a", "b", true, 1), s("b", "a", true, 2)] }))).toEqual({
      a: [2, LEADER],
      b: [3, "a"],
    })
    // 3つの輪と、輪に着く尾(tail)。最も古いのは y
    expect(
      placed(
        placeOrgTree({
          leaderId: LEADER,
          sessions: [s("x", "y", true, 5), s("y", "z", true, 1), s("z", "x", true, 9), s("tail", "z", true, 20)],
        })
      )
    ).toEqual({ y: [2, LEADER], x: [3, "y"], z: [3, "y"], tail: [3, "y"] })
    // 自分自身が親
    expect(placed(placeOrgTree({ leaderId: LEADER, sessions: [s("self", "self", true)] }))).toEqual({ self: [2, LEADER] })
    // 輪にグループ外のセッションが混じり、それが最も古い: 輪の根はグループ外なので木に無い。グループ内のほうは2層目
    expect(
      placed(placeOrgTree({ leaderId: LEADER, sessions: [s("g", "o", true, 5), s("o", "g", false, 1)] }))
    ).toEqual({ g: [2, LEADER] })
  })

  it("指揮役を親にした連鎖(指揮役の親は見ない)。指揮役自身が候補に混じっていても無視する", () => {
    const s = make()
    const result = placed(
      placeOrgTree({
        leaderId: LEADER,
        sessions: [s(LEADER, "a", true), s("a", LEADER, true), s("b", "a", true)],
      })
    )
    expect(result).toEqual({ a: [2, LEADER], b: [3, "a"] })
  })

  it("結果は作成日時の古い順(同じなら ID の順。作成日時が分からないものは後ろ)", () => {
    const s = make()
    const result = placeOrgTree({
      leaderId: LEADER,
      sessions: [s("late", LEADER, true, 300), s("unknown", LEADER, true, null), s("b", LEADER, true, 100), s("a", LEADER, true, 100), s("mid", "late", false, 200)],
    })
    expect(result.map((p) => p.id)).toEqual(["a", "b", "mid", "late", "unknown"])
  })

  it("候補が無ければ空", () => {
    expect(placeOrgTree({ leaderId: LEADER, sessions: [] })).toEqual([])
  })
})

describe("memberDepth", () => {
  it("指揮役=1、親が指揮役(または無し)=2、親が指揮役以外=3", () => {
    expect(memberDepth({ isLeader: true, parentId: null }, LEADER)).toBe(1)
    expect(memberDepth({ isLeader: false, parentId: LEADER }, LEADER)).toBe(2)
    expect(memberDepth({ isLeader: false, parentId: null }, LEADER)).toBe(2)
    expect(memberDepth({ isLeader: false, parentId: "a" }, LEADER)).toBe(3)
    // 指揮役がいないグループ: 親は無く、すべて2層目
    expect(memberDepth({ isLeader: false, parentId: null }, null)).toBe(2)
  })
})

describe("arrangeTree: 並び順は2層目にも3層目にも同じ規則", () => {
  const node = (title: string, parentId: string | null, isLeader = false) => ({ member: { id: title, title, isLeader, parentId } })
  // 作成順で渡す。2層目は 03→01→02、3層目（01 の下）は 補助B→補助A、（03 の下）は 補助10→補助2
  const nodes = [
    node("00_リーダー", null, true),
    node("03_検証", LEADER),
    node("01_画面", LEADER),
    node("補助B", "01_画面"),
    node("02_集計", LEADER),
    node("補助A", "01_画面"),
    node("補助10", "03_検証"),
    node("補助2", "03_検証"),
  ]
  const titles = (list: Array<{ member: { title: string } }>) => list.map((n) => n.member.title)

  it("名前順: 2層目は 01→02→03、3層目は親ごとに 補助A→補助B・補助2→補助10。指揮役は含まない", () => {
    const { children, subs } = arrangeTree(nodes, { leaderId: LEADER, order: "name" })
    expect(titles(children)).toEqual(["01_画面", "02_集計", "03_検証"])
    expect(Object.fromEntries(Object.entries(subs).map(([k, v]) => [k, titles(v)]))).toEqual({
      "01_画面": ["補助A", "補助B"],
      "03_検証": ["補助2", "補助10"],
    })
  })

  it("作成順: 渡された順のまま（3層目も、作成順）", () => {
    const { children, subs } = arrangeTree(nodes, { leaderId: LEADER, order: "created" })
    expect(titles(children)).toEqual(["03_検証", "01_画面", "02_集計"])
    expect(titles(subs["01_画面"])).toEqual(["補助B", "補助A"])
    expect(titles(subs["03_検証"])).toEqual(["補助10", "補助2"])
  })

  it("3層目が無ければ subs は空。指揮役がいなければ、全員が2層目（親なし）", () => {
    expect(arrangeTree([node("01_a", LEADER)], { leaderId: LEADER, order: "name" }).subs).toEqual({})
    const noLeader = arrangeTree([node("02_b", null), node("01_a", null)], { leaderId: null, order: "name" })
    expect(titles(noLeader.children)).toEqual(["01_a", "02_b"])
    expect(noLeader.subs).toEqual({})
  })
})
