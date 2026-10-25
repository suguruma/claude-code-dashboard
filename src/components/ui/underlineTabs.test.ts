import { readFileSync } from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { chooseTab, useTabParam } from "@/hooks/useTabParam"
import { UnderlineTabPanel, UnderlineTabs } from "./underline-tabs"

const TABS = [
  { id: "rules", label: "決まり" },
  { id: "links", label: "つながり" },
] as const

describe("[RM-1] 下線つきのタブ(⑬ A11。⑭ でも使う部品)", () => {
  it("role=tablist の中に role=tab を並べ、選んだタブだけを aria-selected・Tab キーの止まる所にする", () => {
    const html = renderToStaticMarkup(
      createElement(UnderlineTabs<"rules" | "links">, { tabs: TABS, value: "links", onChange: () => {}, idPrefix: "org", label: "組織の表示" })
    )
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="組織の表示"')
    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html).toMatch(/id="org-tab-links"[^>]*aria-selected="true"[^>]*aria-controls="org-panel-links"[^>]*tabindex="0"/)
    expect(html).toMatch(/id="org-tab-rules"[^>]*aria-selected="false"[^>]*tabindex="-1"/)
  })

  it("パネルはタブと結び、選ばれていないパネルは描かない", () => {
    const shown = renderToStaticMarkup(createElement(UnderlineTabPanel, { idPrefix: "org", id: "links", value: "links" }, "中身"))
    expect(shown).toContain('role="tabpanel"')
    expect(shown).toContain('id="org-panel-links"')
    expect(shown).toContain('aria-labelledby="org-tab-links"')
    expect(renderToStaticMarkup(createElement(UnderlineTabPanel, { idPrefix: "org", id: "rules", value: "links" }, "中身"))).toBe("")
  })
})

describe("[RM-1] タブと URL の結び(useTabParam。⑬ 段2 の不具合の直し)", () => {
  function Probe() {
    const [tab] = useTabParam<"rules" | "links">("ccd:test-tab", ["rules", "links"])
    return createElement("span", null, tab === null ? "未定" : tab)
  }

  it("サーバーの描画(ハイドレーションの元)では URL を読まず null を返す。呼ぶ側はタブの中身を出さない", () => {
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>未定</span>")
  })

  it("useSearchParams と、組織のページ全体の Suspense を使わない(開発版で Suspense の中身のハイドレーションが描画を待ち、取得が始まらなかったため)", () => {
    const root = path.resolve(__dirname, "../../..")
    const hook = readFileSync(path.join(root, "src/hooks/useTabParam.ts"), "utf-8")
    const page = readFileSync(path.join(root, "src/app/org-rules/page.tsx"), "utf-8")
    expect(hook).not.toMatch(/useSearchParams\(/)
    expect(page).not.toMatch(/<Suspense/)
  })
})

describe("[WC-1] 前回の選択を覚えない使い方(useUrlTab。⑭ のリソースはサイドバーから開くといつも［利用上限］)", () => {
  const RESOURCE = ["usage", "plan", "load"] as const

  it("URL に正しい値があればそれ。無い・正しくないときは、覚えているかに関係なく最初のタブ", () => {
    expect(chooseTab("load", null, RESOURCE)).toBe("load")
    expect(chooseTab(null, null, RESOURCE)).toBe("usage")
    expect(chooseTab("nope", null, RESOURCE)).toBe("usage")
    expect(chooseTab(undefined, null, RESOURCE)).toBeNull()
  })

  it("覚える使い方(組織)は、URL が無いときに前回の選択を使う(今のまま)", () => {
    expect(chooseTab(null, "links", ["rules", "links"])).toBe("links")
    expect(chooseTab("rules", "links", ["rules", "links"])).toBe("rules")
  })

  it("useUrlTab は localStorage を使わない(usePersistedState を呼ばない)", () => {
    const hook = readFileSync(path.resolve(__dirname, "../../../src/hooks/useTabParam.ts"), "utf-8")
    const body = hook.slice(hook.indexOf("export function useUrlTab"))
    expect(body).not.toMatch(/usePersistedState|localStorage\./)
  })
})
