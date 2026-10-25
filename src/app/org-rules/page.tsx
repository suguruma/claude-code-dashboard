"use client"

import { OrgRulesView } from "@/components/orgRules/OrgRulesView"
import { RelationsView } from "@/components/orgRules/RelationsView"
import { findNavItem } from "@/components/layout/navConfig"
import { UnderlineTabPanel, UnderlineTabs } from "@/components/ui/underline-tabs"
import { useTabParam } from "@/hooks/useTabParam"

const TABS = [
  { id: "rules", label: "決まり" },
  { id: "links", label: "つながり" },
] as const
const TAB_IDS = TABS.map((t) => t.id)
type OrgTab = (typeof TAB_IDS)[number]

/**
 * 組織(⑨・⑬)。上のタブで切り替える。
 * - 決まり(⑨)：全グループ共通の決まり(グローバルの CLAUDE.md)と、グループごとの指揮役の決まり(作業フォルダの CLAUDE.md と記憶)、
 *   設定で足したファイルを、読み取り専用で1か所に並べる
 * - つながり(⑬ の関係性マップ)：誰がどのグループにいて、どの決まり・記憶・スキル・指示ファイルが効いているか
 * 選んだタブは `?tab=` と前回の選択で覚える。
 */
export default function OrgRulesPage() {
  const item = findNavItem("/org-rules")
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{item?.label ?? "組織"}</h1>
        {item?.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
      </div>
      {/* タブは useSearchParams を使わないので、Suspense で包まない(包むと開発版でハイドレーションが描画を待つ。useTabParam) */}
      <OrgTabs />
    </div>
  )
}

function OrgTabs() {
  const [tab, setTab] = useTabParam<OrgTab>("ccd:org-tab", TAB_IDS)
  // URL を読むまで(ハイドレーションの間)は中身を出さない(違うタブの取得を始めないため)
  if (tab === null) return <p className="text-sm text-muted-foreground">読み込み中...</p>
  return (
    <div className="space-y-6">
      <UnderlineTabs tabs={TABS} value={tab} onChange={setTab} idPrefix="org" label="組織の表示" />
      <UnderlineTabPanel idPrefix="org" id="rules" value={tab}>
        <OrgRulesView />
      </UnderlineTabPanel>
      <UnderlineTabPanel idPrefix="org" id="links" value={tab}>
        <RelationsView />
      </UnderlineTabPanel>
    </div>
  )
}
