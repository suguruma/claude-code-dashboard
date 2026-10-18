"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"
import { findNavItem } from "@/components/layout/navConfig"
import { UsageGuardBand } from "@/components/desktopSessions/UsageGuardBand"
import { useUsage } from "@/hooks/useUsage"

/**
 * Claude Desktop の各ページ(セッション一覧・組織図・利用上限)に共通の枠。
 * 見出しと説明はサイドバーの項目(navConfig)から取り、上限ガードの帯を全ページの先頭に1つだけ出す。
 */
export function DesktopSessionsFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const current = findNavItem(pathname)
  const { data: usage } = useUsage()

  return (
    <div className="space-y-6">
      {current && (
        <div>
          <h1 className="text-xl font-semibold">{current.label}</h1>
          {current.description && <p className="text-sm text-muted-foreground">{current.description}</p>}
        </div>
      )}

      {/* 最新の公式値が80%以上のときの上限ガードの帯(表示のみ) */}
      <UsageGuardBand guard={usage?.guard} />

      {children}
    </div>
  )
}
