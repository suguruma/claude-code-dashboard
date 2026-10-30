"use client"

import { useState } from "react"
import { HoverPrefetchLink } from "@/components/layout/HoverPrefetchLink"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { useUsage } from "@/hooks/useUsage"
import { chipHold, chipLabel, kindLabel, resetShort, sortWindows, tightestWindow } from "@/lib/usageChip"
import { formatPercent } from "@/lib/usageFormat"
import type { UsageWindowView } from "@/lib/usageTypes"
import { cn } from "@/lib/utils"

/** 札と鐘の取り方：見えないときは取らない(⑮ A15。利用上限の記録は30秒ごと) */
const CHIP_SWR = { refreshWhenHidden: false }

const hhmm = (t: number) => new Date(t).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })

/**
 * 利用上限の札(⑮ OR-1)。PC の全ページの上のバーに、いちばんきつい窓の％を出す。
 * 1100px 以上は「リセットまで」も、狭いときは％まで(リセットは小窓で)。80% 以上か上限ガード中は「！ 控える」と黄色の地。
 * 押すと小窓に、全部の窓をきつい順に棒・％・推定か公式値か・リセットまでで出す。
 */
export function UsageChip() {
  const { data: usage, error, isLoading } = useUsage(true, CHIP_SWR)
  // リセットまでの時間は、記録を読んだ時刻(30秒ごと)で数える(描くたびに時計を読まない)
  const now = usage?.generatedAt ?? 0
  const [open, setOpen] = useState(false)
  const hold = chipHold(usage)
  const top = usage ? tightestWindow(usage.windows) : null
  const reset = top ? resetShort(top.resetsAt, now) : null

  let face: React.ReactNode
  if (top) {
    face = (
      <>
        {hold && <strong className="whitespace-nowrap">！ 控える</strong>}
        <span className="text-muted-foreground">{chipLabel(top)}</span>
        <strong className="tabular-nums">{formatPercent(top.displayPercent ?? 0)}%</strong>
        {reset && <span className="hidden whitespace-nowrap text-muted-foreground min-[1100px]:inline">リセットまで {reset}</span>}
      </>
    )
  } else if (error && !usage) {
    face = <span className="text-muted-foreground">利用上限 —</span>
  } else if (isLoading && !usage) {
    face = <span className="text-muted-foreground">利用上限 …</span>
  } else {
    face = <span className="text-muted-foreground">利用上限 —</span>
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          hold && "border-[var(--status-warning)] bg-[color-mix(in_oklab,var(--status-warning)_18%,transparent)] hover:bg-[color-mix(in_oklab,var(--status-warning)_26%,transparent)]"
        )}
        aria-label={top ? `利用上限 ${chipLabel(top)} ${formatPercent(top.displayPercent ?? 0)}%${hold ? "・新しい指示を控える" : ""}。押すと全部の窓` : "利用上限"}
        data-testid="usage-chip"
        data-hold={hold ? "true" : "false"}
      >
        {face}
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex items-baseline justify-between gap-3 border-b px-4 py-2.5">
          <PopoverTitle>利用上限</PopoverTitle>
          {usage && <span className="text-muted-foreground">最新 {hhmm(usage.generatedAt)}</span>}
        </div>
        {!usage || usage.windows.length === 0 ? (
          <p className="px-4 py-3 text-muted-foreground">{error ? "読み込めませんでした" : isLoading ? "読み込んでいます" : "利用上限の記録がありません"}</p>
        ) : (
          <ul data-testid="usage-chip-windows">
            {sortWindows(usage.windows).map((w) => (
              <WindowRow key={w.id} w={w} now={now} hold={hold && w === top} />
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between border-t px-4 py-2.5">
          <span className="text-muted-foreground">きつい順</span>
          <HoverPrefetchLink href="/desktop-sessions/usage" className="text-primary hover:underline" onClick={() => setOpen(false)}>
            リソースで見る
          </HoverPrefetchLink>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function WindowRow({ w, now, hold }: { w: UsageWindowView; now: number; hold: boolean }) {
  const p = w.displayPercent
  const reset = resetShort(w.resetsAt, now)
  const official = w.official?.percentUsed ?? null
  return (
    <li className="space-y-1 border-b px-4 py-2.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{w.label}</span>
        <span>
          <strong className="tabular-nums">{p === null ? "—" : `${formatPercent(p)}%`}</strong>
          <span className="text-muted-foreground">（{kindLabel(w)}）</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-muted" aria-hidden>
        <div className="h-full rounded" style={{ width: `${Math.min(100, p ?? 0)}%`, background: (p ?? 0) >= 80 ? "var(--status-warning)" : "var(--foreground)" }} />
      </div>
      {hold && <p className="font-medium">！ 80% を超えた：新しい指示を控える</p>}
      <p className="text-muted-foreground">
        {reset ? `リセットまで ${reset}` : "リセットの時刻は分かりません"}
        {w.resetsAt !== null && `（${hhmm(w.resetsAt)}）`}
        {official !== null && w.estimate.kind === "estimate" && `・公式値 ${formatPercent(official)}%`}
      </p>
    </li>
  )
}
