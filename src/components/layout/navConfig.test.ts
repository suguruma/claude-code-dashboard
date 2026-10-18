import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { HELP_ITEM, NAV_GROUPS, findNavItem } from "./navConfig"

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

  it("Claude Desktop の画面は、見たい内容ごとに3ページに分かれ、グループにまとまっている", () => {
    const group = NAV_GROUPS.find((g) => g.label === "Claude Desktop")
    expect(group?.items.map((i) => [i.href, i.label])).toEqual([
      ["/desktop-sessions", "セッション一覧"],
      ["/desktop-sessions/org", "組織図"],
      ["/desktop-sessions/usage", "利用上限"],
    ])
    // 各ページの見出しの下に出す説明がある
    expect(group?.items.every((i) => (i.description ?? "").length > 0)).toBe(true)
  })

  it("現在のページを、パスの完全一致で引ける(サブページは親の項目に吸収されない)", () => {
    expect(findNavItem("/desktop-sessions")?.label).toBe("セッション一覧")
    expect(findNavItem("/desktop-sessions/org")?.label).toBe("組織図")
    expect(findNavItem("/desktop-sessions/usage")?.label).toBe("利用上限")
    expect(findNavItem("/help")?.label).toBe(HELP_ITEM.label)
    expect(findNavItem("/no-such-page")).toBeNull()
  })

  it("プロジェクトに紐づく設定(ルール・スキル・メモリ・設定)は「設定管理」に並ぶ", () => {
    const group = NAV_GROUPS.find((g) => g.label === "設定管理")
    expect(group?.items.map((i) => i.href)).toEqual(["/rules", "/skills", "/memory", "/settings"])
  })
})
