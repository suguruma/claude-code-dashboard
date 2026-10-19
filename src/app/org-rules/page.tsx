"use client"

import { OrgRulesView } from "@/components/orgRules/OrgRulesView"
import { findNavItem } from "@/components/layout/navConfig"

/**
 * 組織のルール(⑨)。全グループ共通の決まり(グローバルの CLAUDE.md)と、グループごとの指揮役の決まり
 * (作業フォルダの CLAUDE.md と記憶)、設定で足したファイルを、読み取り専用で1か所に並べる。
 */
export default function OrgRulesPage() {
  const item = findNavItem("/org-rules")
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{item?.label ?? "組織のルール"}</h1>
        {item?.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
      </div>
      <OrgRulesView />
    </div>
  )
}
