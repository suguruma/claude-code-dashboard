import { cn } from "@/lib/utils"
import type { DesktopSessionContext } from "@/lib/desktopSessionTypes"
import { ctxLevel, type CtxLevel } from "@/lib/contextLevel"
import { formatTokens } from "./format"

interface ContextBarProps {
  context: DesktopSessionContext | null
  highRatio: number
  /** 詳細表示では上限が仮置きである旨を併記する */
  showNote?: boolean
  /**
   * 段階色で表示する(組織図のカード用)。80%未満は通常、80%以上90%未満は黄、90%以上は赤。
   * 省略時は従来どおり、highRatio 以上を赤にする(一覧・詳細の表示は変えない)。
   */
  levels?: boolean
  /** 狭い場所用(組織図のカード): トークン量と「上限は仮置き」の注記を省き、量は title で見せる(⑬ の棚卸しの行51) */
  compact?: boolean
}

const LEVEL_COLOR: Record<CtxLevel, string> = {
  ok: "bg-primary",
  warning: "bg-[var(--status-warning)]",
  critical: "bg-[var(--status-critical)]",
}
const LEVEL_TEXT: Record<CtxLevel, string | null> = { ok: null, warning: "注意", critical: "危険" }

/** コンテキスト使用量のバーと数値。しきい値以上は色だけでなく「注意」の文言も出す */
export function ContextBar({ context, highRatio, showNote = false, levels = false, compact = false }: ContextBarProps) {
  if (!context) return <span className="text-xs text-muted-foreground">コンテキスト —</span>
  const percent = Math.round(context.ratio * 100)
  const level: CtxLevel = levels ? ctxLevel(context.ratio) : context.ratio >= highRatio ? "critical" : "ok"
  const label = levels ? LEVEL_TEXT[level] : level === "critical" ? "注意" : null
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span title={`${formatTokens(context.tokens)} / ${formatTokens(context.limit)}`}>
          {compact ? "コンテキスト" : `${formatTokens(context.tokens)} / ${formatTokens(context.limit)}`}
          {!compact && <span className="text-muted-foreground">（上限は仮置き）</span>}
        </span>
        <span
          className={cn(
            "font-medium",
            level === "critical" && "text-[var(--status-critical-text)]",
            level === "warning" && "text-foreground"
          )}
        >
          {percent}%{label && `（${label}）`}
        </span>
      </div>
      <div
        role="meter"
        aria-label="コンテキスト使用率"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        data-level={level}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full", LEVEL_COLOR[level])} style={{ width: `${Math.max(2, percent)}%` }} />
      </div>
      {showNote && (
        <p className="text-[11px] text-muted-foreground">
          上限は記録されていないため、モデルごとの仮置き値で割っています。
        </p>
      )}
    </div>
  )
}
