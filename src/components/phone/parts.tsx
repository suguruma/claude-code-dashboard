"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { ctxLevel, type CtxLevel } from "@/lib/contextLevel"
import type { DesktopNeedsActionInfo, DesktopSessionContext, DesktopSessionStatus, DesktopStandbyInfo } from "@/lib/desktopSessionTypes"
import { statusMetaOf } from "@/components/desktopSessions/statusMeta"

/**
 * スマホ用のページ(⑪-2)の小さな部品。文字は本文16px・補足13px以上(Q18)。大きさは rem で書く
 * (ブラウザの文字の大きさの設定に合わせて大きくなるように)。
 */

/** 補足の文字(13px) */
export const META = "text-[0.8125rem] leading-snug text-muted-foreground"

/** カードの枠 */
export const CARD = "rounded-xl border bg-card"

/** 押せるカード・行(高さ44px以上・押したときに分かる) */
export const TAPPABLE =
  "block w-full min-h-11 text-left transition-colors active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function PhoneStatusBadge({
  status,
  info,
  standby,
}: {
  status: DesktopSessionStatus
  info?: DesktopNeedsActionInfo | null
  standby?: DesktopStandbyInfo | null
}) {
  const { label, Icon, color, estimated } = statusMetaOf(status, info, standby)
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[0.8125rem] font-medium">
      <Icon className="size-4 shrink-0" style={{ color }} aria-hidden />
      <span className="truncate">
        {label}
        {estimated && <span className="font-normal text-muted-foreground">（推定）</span>}
      </span>
    </span>
  )
}

const CTX_BAR: Record<CtxLevel, string> = {
  ok: "bg-primary",
  warning: "bg-[var(--status-warning)]",
  critical: "bg-[var(--status-critical)]",
}
const CTX_TEXT: Record<CtxLevel, string | null> = { ok: null, warning: "注意", critical: "危険" }

/** コンテキストの%(数とバー)。80%で注意、90%で危険(色だけに頼らず文字も出す) */
export function PhoneContextMeter({ context, label = true }: { context: DesktopSessionContext | null; label?: boolean }) {
  if (!context) return <span className={META}>{label ? "コンテキスト —" : "—"}</span>
  const percent = Math.round(context.ratio * 100)
  const level = ctxLevel(context.ratio)
  const levelText = CTX_TEXT[level]
  return (
    <span className="flex min-w-0 items-center gap-2">
      {label && <span className="text-[0.8125rem] text-muted-foreground">コンテキスト</span>}
      <span
        role="meter"
        aria-label="コンテキスト使用率"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 min-w-8 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <span className={cn("block h-full rounded-full", CTX_BAR[level])} style={{ width: `${Math.max(2, percent)}%` }} />
      </span>
      <span
        className={cn("text-[0.8125rem] font-medium tabular-nums", level === "critical" && "text-[var(--status-critical-text)]")}
      >
        {percent}%{levelText && `（${levelText}）`}
      </span>
    </span>
  )
}

/** 読み込み中・読み込めない・データが無いときのお知らせ */
export function PhoneNotice({
  error,
  isLoading,
  hasData,
  empty,
}: {
  error: Error | undefined
  isLoading: boolean
  hasData: boolean
  /** データはあるが、見せるものが無いときの文(Desktop のデータが見つからないなど) */
  empty?: string | null
}) {
  if (error && !hasData) {
    return (
      <p role="alert" className={cn(CARD, "border-[var(--status-critical)] p-4 text-base")}>
        読み込めませんでした。PC でダッシュボードが動いているか確かめてください。
        <span className={cn(META, "mt-1 block")}>{error.message}</span>
      </p>
    )
  }
  if (!hasData && isLoading) return <p className="py-6 text-center text-base text-muted-foreground">読み込み中...</p>
  if (empty) return <p className={cn(CARD, "p-4 text-base")}>{empty}</p>
  return null
}

/** 見出しと件数 */
export function SectionTitle({ children, count }: { children: ReactNode; count?: number | null }) {
  return (
    <h2 className="flex items-baseline gap-2 text-base font-semibold">
      {children}
      {count !== undefined && count !== null && <span className="text-[0.8125rem] font-normal text-muted-foreground">{count}件</span>}
    </h2>
  )
}
