"use client"

import { AlertTriangle } from "lucide-react"
import { HoverPrefetchLink } from "@/components/layout/HoverPrefetchLink"
import { useMonitorAlerts } from "@/hooks/useMonitor"
import { homeAlertText, pageAlertText } from "@/lib/monitor/loadView"

/**
 * PC の警告(⑭ WC-6・WC-12)。数と時間帯は alert の行から。Dashboard は自分でしきい値と比べない。
 * - ResourceAlertBand：リソースのページのタブの下。直近24時間の CPU・メモリの最後の帯と［ピークを見る］
 * - PcAlertStrip：ホームの帯の枠(HomeBands)の pcAlert。直近10分は赤い枠、過ぎてから24時間は灰色の1行。CPU とメモリは1本。
 *   警告が無い・読み込み中・取れないときは何も描かない(枠の高さは変わらない。要件メモ 14 の 4-4)
 */
export function ResourceAlertBand({ onPeak }: { onPeak: (at: number) => void }) {
  const summary = useMonitorAlerts()
  if (!summary || summary.items.length === 0) return null
  return (
    <div className="space-y-2" data-testid="resource-alert-band">
      {summary.items.map((item) => (
        <div
          key={item.key}
          role="status"
          className="flex flex-wrap items-center gap-x-3 rounded-lg border px-3 text-sm"
          style={item.active ? { borderColor: "var(--status-critical)" } : undefined}
        >
          <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: "var(--status-critical-text)" }}>
            <AlertTriangle className="size-4" aria-hidden />！ 警告
          </span>
          <span>{pageAlertText(item)}</span>
          <button type="button" className="ml-auto inline-flex min-h-9 items-center text-primary hover:underline" onClick={() => onPeak(item.band.peakAt)}>
            ピークを見る
          </button>
        </div>
      ))}
    </div>
  )
}

export function PcAlertStrip() {
  const summary = useMonitorAlerts()
  const line = summary ? homeAlertText(summary.items) : null
  if (!line) return null
  return (
    <div
      className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-sm"
      style={line.active ? { borderColor: "var(--status-critical)" } : undefined}
      role={line.active ? "alert" : undefined}
      data-testid="home-pc-alert"
      data-active={line.active}
    >
      <span className={line.active ? "font-semibold" : "text-muted-foreground"} style={line.active ? { color: "var(--status-critical-text)" } : undefined}>
        {line.text}
      </span>
      <HoverPrefetchLink href="/desktop-sessions/usage?tab=load" className="ml-auto text-primary hover:underline">
        負荷を見る
      </HoverPrefetchLink>
    </div>
  )
}
