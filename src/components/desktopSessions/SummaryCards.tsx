import { Activity, Eye, Gauge, OctagonAlert, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { DesktopSessionCounts } from "@/lib/desktopSessionTypes"
import type { StatusFilter } from "@/lib/desktopSessionFilters"

interface SummaryCardsProps {
  counts: DesktopSessionCounts
  highContextRatio: number
  selected: StatusFilter
  onSelect: (filter: StatusFilter) => void
}

interface CardDef {
  filter: StatusFilter
  label: string
  value: number
  Icon: LucideIcon
  color: string
}

/** 件数カード。押すとその状態で一覧を絞り込み、もう一度押すと解除する */
export function SummaryCards({ counts, highContextRatio, selected, onSelect }: SummaryCardsProps) {
  const cards: CardDef[] = [
    { filter: "running", label: "実行中（推定）", value: counts.running, Icon: Activity, color: "var(--primary)" },
    { filter: "blocked", label: "要対応", value: counts.blocked, Icon: OctagonAlert, color: "var(--status-critical)" },
    { filter: "review_ready", label: "確認待ち", value: counts.reviewReady, Icon: Eye, color: "var(--status-warning)" },
    {
      filter: "highContext",
      label: `コンテキスト${Math.round(highContextRatio * 100)}%以上`,
      value: counts.highContext,
      Icon: Gauge,
      color: "var(--status-warning)",
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ filter, label, value, Icon, color }) => {
        const active = selected === filter
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? "all" : filter)}
            className={cn(
              "rounded-xl p-4 text-left ring-1 ring-foreground/10 transition-colors hover:ring-primary",
              active && "bg-accent ring-primary"
            )}
          >
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Icon className="size-4" style={{ color }} aria-hidden />
              {label}
            </span>
            <span className="mt-1 block text-2xl font-semibold tabular-nums">{value}</span>
          </button>
        )
      })}
    </div>
  )
}
