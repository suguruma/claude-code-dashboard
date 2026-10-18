import { cn } from "@/lib/utils"
import type { DesktopSessionContext } from "@/lib/desktopSessionTypes"
import { formatTokens } from "./format"

interface ContextBarProps {
  context: DesktopSessionContext | null
  highRatio: number
  /** 詳細表示では上限が仮置きである旨を併記する */
  showNote?: boolean
}

/** コンテキスト使用量のバーと数値。しきい値以上は色だけでなく「注意」の文言も出す */
export function ContextBar({ context, highRatio, showNote = false }: ContextBarProps) {
  if (!context) return <span className="text-xs text-muted-foreground">コンテキスト —</span>
  const percent = Math.round(context.ratio * 100)
  const high = context.ratio >= highRatio
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span>
          {formatTokens(context.tokens)} / {formatTokens(context.limit)}
          <span className="text-muted-foreground">（上限は仮置き）</span>
        </span>
        <span className={cn("font-medium", high && "text-[var(--status-critical)]")}>
          {percent}%{high && "（注意）"}
        </span>
      </div>
      <div
        role="meter"
        aria-label="コンテキスト使用率"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", high ? "bg-[var(--status-critical)]" : "bg-primary")}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
      {showNote && (
        <p className="text-[11px] text-muted-foreground">
          上限は記録されていないため、モデルごとの仮置き値で割っています。
        </p>
      )}
    </div>
  )
}
