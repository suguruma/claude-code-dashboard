import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import nextConfig from "../../next.config"
import { HELP_ITEM, NAV_GROUPS } from "@/components/layout/navConfig"
import { REMOVED_PAGES } from "./removedPages"

const appDir = path.join(process.cwd(), "src", "app")
const pageOf = (href: string) => path.join(appDir, href === "/" ? "" : href, "page.tsx")

describe("[FS-1] やめたページ(⑬ A18)", () => {
  it("やめたページは、サイドバーから消え、ページのファイルも無い", () => {
    const navHrefs = [...NAV_GROUPS.flatMap((g) => g.items), HELP_ITEM].map((i) => i.href)
    for (const { source } of REMOVED_PAGES) {
      expect(navHrefs, source).not.toContain(source)
      expect(existsSync(pageOf(source)), source).toBe(false)
    }
  })

  it("行き先は、残っているページ(404 にしない)", () => {
    for (const { destination } of REMOVED_PAGES) {
      const pathname = destination.split(/[?#]/)[0]
      expect(existsSync(pageOf(pathname)), destination).toBe(true)
    }
  })

  it("next.config の redirects で、行き先へ一時的な移動(307)をする", async () => {
    const redirects = await nextConfig.redirects!()
    expect(redirects).toEqual(REMOVED_PAGES.map(({ source, destination }) => ({ source, destination, permanent: false })))
    expect(Object.fromEntries(redirects.map((r) => [r.source, r.destination]))).toEqual({
      "/project": "/",
      "/tasks": "/",
      "/memory": "/org-rules?tab=rules#org-memory",
      "/session-monitor": "/desktop-sessions",
    })
  })
})

describe("[FS-5] 消したコードは残っていない(⑬ A22。消した量は報告71 に書いた)", () => {
  it("やめた機能の lib・API・部品のファイルが無い(テストは同じコミットで消した)", () => {
    const removed = [
      "src/lib/cliProcesses.ts",
      "src/lib/plugins.ts",
      "src/lib/skillArchive.ts",
      "src/lib/taskHistory.ts",
      "src/app/api/plugins/route.ts",
      "src/app/api/tasks/route.ts",
      "src/app/api/session-monitor/projects/route.ts",
      "src/app/api/skills/[dirName]/archive/route.ts",
      "src/app/api/skills/[dirName]/restore/route.ts",
      "src/components/desktopSessions/OrgReplayControls.tsx",
      "src/components/desktopSessions/HousekeepingDecisionList.tsx",
      "src/components/settings/PluginBlocklist.tsx",
      "src/components/settings/SettingsEditDialog.tsx",
      "src/components/skills/SkillArchiveDialog.tsx",
      "src/hooks/usePlugins.ts",
      "src/hooks/useTaskSessions.ts",
    ]
    for (const rel of removed) expect(existsSync(path.join(process.cwd(), rel)), rel).toBe(false)
  })
})

describe("[FS-1] 画面の文とリンクに、やめたページが残っていない(報告74 で見つけた残り)", () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(full)
    }
  }
  walk(path.join(process.cwd(), "src"))
  // 旧 URL の表(removedPages.ts)と、/help の「前にあったページはどこへ？」の答えだけは、やめたページの名前を書いてよい
  const allowed = (f: string) => /removedPages\.ts$|[\\/]help[\\/]page\.tsx$/.test(f)

  it("やめたページへのリンク(href)が無い", () => {
    for (const f of files) {
      expect(readFileSync(f, "utf-8"), f).not.toMatch(/href=["{`]+\/(project|tasks|memory|session-monitor)/)
    }
  })

  it("やめたページの名前を、画面の文に書かない(経緯を書いたコメントは除く)", () => {
    const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const f of files.filter((x) => !allowed(x))) {
      expect(withoutComments(readFileSync(f, "utf-8")), f).not.toMatch(/プロジェクトの概要|タスク履歴|メモリ管理|セッション監視のページ/)
    }
  })
})
