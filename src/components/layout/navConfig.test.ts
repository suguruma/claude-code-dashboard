import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { HELP_ITEM, NAV_GROUPS, findNavItem, showsProjectSwitcher } from "./navConfig"

const appDir = path.join(process.cwd(), "src", "app")
const items = [...NAV_GROUPS.flatMap((g) => g.items), HELP_ITEM]

describe("サイドバーの項目", () => {
  it("どの項目も、対応するページ(page.tsx)がある。リンク切れを作らない", () => {
    for (const item of items) {
      const page = path.join(appDir, item.href === "/" ? "" : item.href, "page.tsx")
      expect(existsSync(page), `${item.href} のページが無い`).toBe(true)
    }
  })

  it("同じ宛先の項目を重ねない。ラベルも重ねない", () => {
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length)
    expect(new Set(items.map((i) => i.label)).size).toBe(items.length)
  })

  it("Claude Desktop の画面は、見たい内容ごとにページに分かれ、グループにまとまっている（組織図はホームに出す）", () => {
    const group = NAV_GROUPS.find((g) => g.label === "Claude Desktop")
    expect(group?.items.map((i) => [i.href, i.label])).toEqual([
      ["/desktop-sessions", "セッション一覧"],
      ["/desktop-sessions/usage", "利用上限"],
      ["/desktop-sessions/housekeeping", "整理"],
      ["/org-rules", "組織"],
    ])
    // 各ページの見出しの下に出す説明がある
    expect(group?.items.every((i) => (i.description ?? "").length > 0)).toBe(true)
  })

  it("現在のページを、パスの完全一致で引ける(サブページは親の項目に吸収されない)", () => {
    expect(findNavItem("/desktop-sessions")?.label).toBe("セッション一覧")
    // 組織図のページはホームへ移すだけなので、サイドバーの項目は無い
    expect(findNavItem("/desktop-sessions/org")).toBeNull()
    expect(findNavItem("/desktop-sessions/usage")?.label).toBe("利用上限")
    expect(findNavItem("/desktop-sessions/housekeeping")?.label).toBe("整理")
    expect(findNavItem("/org-rules")?.label).toBe("組織")
    expect(findNavItem("/help")?.label).toBe(HELP_ITEM.label)
    expect(findNavItem("/no-such-page")).toBeNull()
  })

  it("[FS-1] プロジェクトに紐づく設定は「設定管理」に並ぶ(プロジェクトの概要・メモリ管理は ⑬ でやめた)", () => {
    const group = NAV_GROUPS.find((g) => g.label === "設定管理")
    expect(group?.items.map((i) => i.href)).toEqual(["/rules", "/skills", "/settings"])
  })

  it("[FS-1, RM-1] サイドバーは13ページ(⑬ の機能の整理。使い方ガイドを含む)", () => {
    expect(items.map((i) => i.label)).toEqual([
      "ホーム",
      "セッション一覧",
      "利用上限",
      "整理",
      "組織",
      "ルール管理",
      "スキル管理",
      "設定",
      "実行ログ",
      "ルール整理",
      "移行",
      "スマホから見る",
      "使い方ガイド",
    ])
  })

  it("並びは、ホーム → Claude Desktop → 設定管理 → 分析・振り返り → ツール。ホームのすぐ次がセッション一覧", () => {
    expect(NAV_GROUPS.map((g) => g.label ?? null)).toEqual([null, "Claude Desktop", "設定管理", "分析・振り返り", "ツール"])
    const flat = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))
    expect(flat.slice(0, 2)).toEqual(["/", "/desktop-sessions"])
  })
})

describe("プロジェクトの切り替えを出すページ(⑧の表)", () => {
  // 出す・出さないを変えるときは、navConfig の usesProject と、この表を1行ずつ直す
  const table: Record<string, boolean> = {
    "/": false,
    "/desktop-sessions": false,
    "/desktop-sessions/usage": false,
    "/desktop-sessions/housekeeping": false,
    "/org-rules": false,
    "/rules": true,
    "/skills": true,
    "/settings": true,
    "/trace": true,
    "/migrate": true,
    "/refactor": true,
    "/lan-access": false,
    "/help": false,
  }

  it("サイドバーの全項目が表にあり、表のとおりに出す・出さない", () => {
    expect(Object.keys(table).sort()).toEqual(items.map((i) => i.href).sort())
    for (const [pathname, shows] of Object.entries(table)) expect(showsProjectSwitcher(pathname), pathname).toBe(shows)
  })

  it("サイドバーに無いページ(ホームへ移る組織図・知らないパス)には出さない", () => {
    expect(showsProjectSwitcher("/desktop-sessions/org")).toBe(false)
    expect(showsProjectSwitcher("/no-such-page")).toBe(false)
  })
})
