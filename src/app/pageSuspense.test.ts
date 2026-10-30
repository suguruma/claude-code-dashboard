import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf-8")

describe("[A26] [RM-1, FS-4] ページ全体を Suspense で包まない(開発版で中身のハイドレーションが描画を待ち、取得が始まらなかったため。報告72)", () => {
  it("組織・セッション一覧・整理のページは <Suspense を持たず、useSearchParams を使う hook を直接呼ばない", () => {
    for (const rel of ["src/app/org-rules/page.tsx", "src/app/desktop-sessions/page.tsx", "src/app/desktop-sessions/housekeeping/page.tsx"]) {
      const src = read(rel)
      expect(src, rel).not.toMatch(/<Suspense/)
      expect(src, rel).not.toMatch(/useSelectedSession\(\)|useSelectedSessionId\(\)|useSearchParams\(/)
    }
  })

  it("`?session=` を読む詳細のダイアログだけを、小さな Suspense に入れる", () => {
    const dialog = read("src/components/desktopSessions/SelectedSessionDialog.tsx")
    expect(dialog).toMatch(/<Suspense fallback=\{null\}>\s*<DialogFromUrl/)
    expect(read("src/app/desktop-sessions/page.tsx")).toContain("<SelectedSessionDialog")
    expect(read("src/app/desktop-sessions/housekeeping/page.tsx")).toContain("<SelectedSessionDialog")
  })
})
