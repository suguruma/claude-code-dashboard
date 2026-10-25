import { describe, expect, it } from "vitest"
import type { LedgerMark, RelationEffects, RelationSession } from "./relationsTypes"
import { deliveryText } from "./relationsTypes"
import { coverageLine, defaultSelection, effectRows, formatWhen, groupMeta, ledgerLine, orderCards, splitCards } from "./relationsView"

const NOW = new Date(2026, 9, 25, 12, 0).getTime()
const MIN = 60_000

const mark = (at: number | null, status: LedgerMark["status"] = "ok"): LedgerMark => ({ name: "01.md", lastNumber: 1, updatedAt: at, status })

function session(id: string, over: Partial<RelationSession> = {}): RelationSession {
  return {
    id,
    title: id,
    groupId: "g",
    role: "member",
    spawnedFromId: null,
    status: "completed",
    folderName: null,
    branch: null,
    sameFolderIds: [],
    orders: null,
    reports: null,
    lastActivityAt: null,
    ...over,
  }
}

const EFFECTS: RelationEffects = {
  global: { status: "ok", updatedAt: NOW - 60 * MIN },
  folderRules: [{ key: "rule:1", label: "app-one", updatedAt: NOW, sessionIds: ["s1", "s9"] }],
  memories: [{ key: "memory:1", label: "会話ログのフォルダの memory", updatedAt: NOW, sessionIds: ["s1"], count: 16 }],
  userSkills: 8,
  usedSkills: [
    { name: "skill-a", calls: 5, sessionIds: ["s1", "s2"] },
    { name: "skill-b", calls: 2, sessionIds: ["s9"] },
  ],
  cloudSkipped: 0,
}

describe("[RM-4] 指示と報告の時刻(A14)", () => {
  it("指示の更新が報告より新しければ「報告待ち n分」。番号は並べない", () => {
    const at = (h: number, m: number) => new Date(2026, 9, 25, h, m).getTime()
    expect(ledgerLine(mark(at(6, 10)), mark(at(5, 20)), at(7, 0))).toEqual({ text: "指示 06:10・報告 05:20", waiting: "報告待ち 50分" })
    expect(ledgerLine(mark(at(5, 0)), mark(at(5, 20)), at(7, 0))).toEqual({ text: "指示 05:00・報告 05:20", waiting: null })
    expect(ledgerLine(mark(at(6, 10)), null, at(6, 40))?.waiting).toBe("報告待ち 30分")
  })

  it("結んでいなければ null(カードに書かない)。ファイルが無い・読めないは文で", () => {
    expect(ledgerLine(null, null, NOW)).toBeNull()
    expect(ledgerLine(mark(null, "missing"), mark(null, "refused"), NOW)).toEqual({ text: "指示のファイルが無い・報告のファイルを読めない", waiting: null })
  })
})

describe("[RM-2, RM-3] カード(A12・A13・N3)", () => {
  it("指揮役 → 担当 → 確認役・補助の順。7件以上は最初の6枚と残り", () => {
    const list = [session("b", { role: "helper" }), session("z"), session("a", { role: "leader" }), session("c")]
    expect(orderCards(list).map((s) => s.id)).toEqual(["a", "c", "z", "b"])
    const many = Array.from({ length: 9 }, (_, i) => i)
    expect(splitCards(many, false)).toEqual({ shown: [0, 1, 2, 3, 4, 5], hidden: [6, 7, 8] })
    expect(splitCards(many, true).hidden).toEqual([])
    // 7件ちょうどなら、1件だけ隠すより全部出す
    expect(splitCards(many.slice(0, 7), false).hidden).toEqual([])
  })

  it("見出しの下に「分かるもの n/m」の1行", () => {
    const list = [session("a", { branch: "main" }), session("b", { orders: mark(NOW) }), session("c")]
    expect(coverageLine(list)).toBe("ブランチが分かるもの 1/3・指示の置き場を設定したもの 1/3（分からないものは、カードに書きません）")
  })

  it("最初に選ぶのは最初の担当", () => {
    expect(defaultSelection([session("L", { role: "leader" }), session("m2"), session("m1")])).toBe("m1")
    expect(defaultSelection([])).toBeNull()
  })

  it("グループの一覧の補足", () => {
    expect(groupMeta({ count: 9, decisions: 2, unansweredRequests: 1, spawnedLinks: 3 })).toBe("9件・判断 2・頼みの返事なし 1")
    expect(groupMeta({ count: 3, decisions: 0, unansweredRequests: 0, spawnedLinks: 0 })).toBe("3件・判断 0・立てた線なし")
  })
})

describe("[RM-6] 効いているものの表(A16・N4)", () => {
  const group = [session("s1", { orders: mark(NOW - 30 * MIN) }), session("s2")]
  const all = [...group, session("s9", { groupId: "other" })]

  it("グループに効くものだけを、選んだセッションに効くかの列つきで並べる", () => {
    const rows = effectRows({ effects: EFFECTS, sessions: all }, group, group[0])
    expect(rows.map((r) => [r.kind, r.forSelected])).toEqual([
      ["全体の決まり", "効く"],
      ["作業フォルダの決まり", "効く"],
      ["記憶", "効く"],
      ["スキル", "使った 1個"],
      ["指示ファイル", "効く"],
    ])
    expect(rows[0].target).toBe("全セッション（3件）")
    expect(rows[2].what).toBe("会話ログのフォルダの memory（16ファイル）")
  })

  it("スキルの判断は、全セッションで直近30日に使っていない数。グループの数は効く先に事実として書く", () => {
    const skills = effectRows({ effects: EFFECTS, sessions: all }, group, group[1]).find((r) => r.kind === "スキル")!
    expect(skills.decide).toBe("全セッションで直近30日に使っていない6個を片付けるか")
    expect(skills.target).toBe("全セッション（このグループが直近30日に使ったのは1個）")
    expect(skills.forSelected).toBe("使った 1個")
  })

  it("選んだセッションに効かないものは「—」。調べていないものは行を出さない", () => {
    const rows = effectRows(
      { effects: { ...EFFECTS, global: { status: "disabled", updatedAt: null }, userSkills: null }, sessions: all },
      group,
      group[1]
    )
    expect(rows.map((r) => [r.kind, r.forSelected])).toEqual([
      ["作業フォルダの決まり", "—"],
      ["記憶", "—"],
      ["指示ファイル", "—"],
    ])
  })
})

describe("文の形", () => {
  it("時刻は今日・昨日・それより前で書き分ける", () => {
    expect(formatWhen(new Date(2026, 9, 25, 5, 40).getTime(), NOW)).toBe("今日 05:40")
    expect(formatWhen(new Date(2026, 9, 24, 22, 30).getTime(), NOW)).toBe("昨日 22:30")
    expect(formatWhen(new Date(2026, 9, 20, 9, 0).getTime(), NOW)).toBe("10/20")
    expect(formatWhen(null, NOW)).toBe("—")
  })

  it("頼みの返事の具合を文字で書く(色だけに頼らない。A17)", () => {
    const base = { delivery: "delivered" as const, readAt: null, repliedAt: null }
    expect(deliveryText(base)).toBe("届いた・未読")
    expect(deliveryText({ ...base, readAt: 1 })).toBe("読んだ・返事なし")
    expect(deliveryText({ ...base, readAt: 1, repliedAt: 2 })).toBe("返事あり")
    expect(deliveryText({ ...base, delivery: "undelivered" })).toBe("届かなかった")
  })
})
