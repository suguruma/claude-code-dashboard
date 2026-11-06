import { describe, expect, it } from "vitest"
import { makeSessionSummary } from "./desktopFixtures"
import type { DesktopSessionGroup } from "./desktopSessionTypes"
import { detailHref, emptyBuckets, EMPTY_PER_BUCKET, normalizeForSearch, searchJump } from "./jumpSearch"
import { buildMarks } from "./statusMark"

// 値はどれも合成
const NOW = 1_800_000_000_000
const MIN = 60_000
const g = { id: "g1", name: "試験グループ" }
const sessions = [
  makeSessionSummary("d1", { title: "判断_書き込みの許可", status: "blocked", lastActivityAt: NOW - 10 * MIN }),
  makeSessionSummary("d2", { title: "判断_方針の確認", status: "blocked", lastActivityAt: NOW - 5 * MIN }),
  makeSessionSummary("d3", { title: "03_検証", status: "error", lastActivityAt: NOW - 30 * MIN }),
  makeSessionSummary("d4", { title: "判断_古い質問", status: "blocked", lastActivityAt: NOW - 90 * MIN }),
  makeSessionSummary("c1", { title: "00_リーダー_試験", status: "standby", group: g, lastActivityAt: NOW - 12 * MIN }),
  makeSessionSummary("c2", { title: "01_調査", status: "waiting", folderName: "SampleApp", lastActivityAt: NOW - 25 * MIN }),
  makeSessionSummary("i1", { title: "04_文書の整備", status: "interrupted", group: g, lastActivityAt: NOW - 42 * MIN }),
  makeSessionSummary("r1", { title: "02_集計ＡＢＣ", status: "running", group: g, lastActivityAt: NOW - 1 * MIN }),
  makeSessionSummary("a1", { title: "判断_アーカイブ済み", status: "blocked", isArchived: true }),
]
const groups: DesktopSessionGroup[] = [{ id: "g1", name: "試験グループ", order: 0, count: 3 }]
const pages = [
  { href: "/", label: "ホーム" },
  { href: "/desktop-sessions", label: "セッション一覧" },
  { href: "/desktop-sessions/usage", label: "リソース" },
]
const marks = buildMarks(sessions, NOW)
const titles = (b: { items: { title: string }[] }) => b.items.map((i) => i.title)

describe("[OR-5] 飛び先の検索", () => {
  it("空のときは束ごとに最大3件。判断(新しい順) → 終わった → 止まったかもしれない。アーカイブ済みは出さない", () => {
    const b = emptyBuckets(sessions, marks)
    expect(b.map((x) => x.label)).toEqual(["次にやる判断", "終わった", "止まったかもしれない"])
    expect(titles(b[0])).toEqual(["判断_方針の確認", "判断_書き込みの許可", "03_検証"])
    expect(b[0].items).toHaveLength(EMPTY_PER_BUCKET)
    expect(titles(b[1])).toEqual(["00_リーダー_試験", "01_調査"])
    expect(titles(b[2])).toEqual(["04_文書の整備"])
  })

  it("部分一致。真ん中の文字・全角と半角の違い・大文字と小文字の違いでも見つかる", () => {
    expect(titles(searchJump("書き込", sessions, groups, pages, marks)[0])).toEqual(["判断_書き込みの許可"])
    expect(titles(searchJump("abc", sessions, groups, pages, marks)[0])).toEqual(["02_集計ＡＢＣ"])
    expect(titles(searchJump("ｓａｍｐｌｅａｐｐ", sessions, groups, pages, marks)[0])).toEqual(["01_調査"])
    expect(normalizeForSearch("ＡＢＣ　ｄｅ")).toBe("abc de")
  })

  it("セッションは判断待ち → 新しい順。グループ名でもセッションが見つかり、グループとページも探す", () => {
    const r = searchJump("判断", sessions, groups, pages, marks)
    expect(titles(r[0])).toEqual(["判断_方針の確認", "判断_書き込みの許可", "判断_古い質問"])
    const byGroup = searchJump("試験", sessions, groups, pages, marks)
    expect(byGroup.map((x) => x.label)).toEqual(["セッション", "グループ"])
    expect(titles(byGroup[0])).toEqual(["02_集計ＡＢＣ", "00_リーダー_試験", "04_文書の整備"])
    expect(searchJump("一覧", sessions, groups, pages, marks)).toEqual([{ label: "ページ", items: [{ kind: "page", id: "/desktop-sessions", title: "セッション一覧", sub: null, href: "/desktop-sessions" }] }])
    expect(searchJump("  ", sessions, groups, pages, marks)).toEqual([])
    expect(searchJump("ほげ", sessions, groups, pages, marks)).toEqual([])
  })

  it("Enter の行き先：詳細のダイアログを持つページならそのまま、ほかはセッション一覧の詳細", () => {
    expect(detailHref("/", "local_x")).toBe("/?session=local_x")
    expect(detailHref("/rules", "local_x")).toBe("/desktop-sessions?session=local_x")
  })
})
