"use client"

import { LanAccessView } from "@/components/lanAccess/LanAccessView"
import { findNavItem } from "@/components/layout/navConfig"

/**
 * スマホから見る(⑪)。同じ家の Wi-Fi のスマホから、Claude Desktop の4ページを読み取り専用で見るための設定。
 * オン・オフと端末の管理は、この PC の画面からだけ(LAN の入り口は、このページと管理の API を通さない)。
 */
export default function LanAccessPage() {
  const item = findNavItem("/lan-access")
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{item?.label ?? "スマホから見る"}</h1>
        {item?.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
      </div>
      <LanAccessView />
    </div>
  )
}
