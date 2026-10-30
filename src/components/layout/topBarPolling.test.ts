import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const read = (f: string) => readFileSync(path.resolve(__dirname, f), "utf-8")

// ⑮ A15：上のバーとサイドバーは、セッション系以外のページでも読むので、30秒ごとにし、見えないときは読まない
describe("[OR-1] [OR-2] 上のバーとサイドバーの取り方", () => {
  it("サイドバーの「判断 n」は30秒ごと・見えないときは読まない。利用上限の札も見えないときは読まない", () => {
    expect(read("SideNav.tsx")).toMatch(/NAV_SWR = \{ refreshInterval: 30_000, refreshWhenHidden: false \}/)
    expect(read("UsageChip.tsx")).toMatch(/CHIP_SWR = \{ refreshWhenHidden: false \}/)
    expect(read("../../hooks/useUsage.ts")).toMatch(/POLL_VISIBLE_MS = 30_000/)
  })
})
