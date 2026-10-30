import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { NAV_GROUPS } from "@/components/layout/navConfig"
import { REMOVED_PAGES } from "@/lib/removedPages"

const helpSource = readFileSync(path.join(process.cwd(), "src", "app", "help", "page.tsx"), "utf-8")
const guides = helpSource.slice(helpSource.indexOf("const PAGE_GUIDES"), helpSource.indexOf("const FAQ"))

describe("[FS-6] 使い方ガイドの「各ページの使い方」(⑬ A23)", () => {
  it("サイドバーのページと同じ並び・同じ名前で、1つずつ説明がある", () => {
    const navItems = NAV_GROUPS.flatMap((g) => g.items)
    const helpItems = [...guides.matchAll(/href: "([^"]+)",\r?\n\s+label: "([^"]+)"/g)].map((m) => ({ href: m[1], label: m[2] }))
    expect(new Set(helpItems.map((i) => i.href))).toEqual(new Set(navItems.map((i) => i.href)))
    for (const item of navItems) expect(helpItems.find((h) => h.href === item.href)?.label, item.href).toBe(item.label)
  })

  it("やめたページの項は残っていない", () => {
    for (const { source } of REMOVED_PAGES) expect(guides, source).not.toContain(`href: "${source}"`)
    for (const label of ["プロジェクトの概要", "メモリ管理", "セッション監視", "タスク履歴", "組織のルール"]) {
      expect(guides, label).not.toContain(`label: "${label}"`)
    }
  })
})
