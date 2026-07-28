import { AlertTriangle, CheckCircle2, Info, OctagonAlert, type LucideIcon } from "lucide-react"
import { DiagnosisSeverity } from "@/lib/sessionDiagnostics"

/**
 * 判定を「色 + アイコンの形 + 日本語ラベル」の3重で表現するための定義。
 * 状態色は白背景でコントラストが不足するもの（注意色）を含むため、
 * 色だけで意味を伝えず、必ず形とラベルを併記する前提で使う。
 */
export interface StatusToken {
  label: string
  Icon: LucideIcon
  /** アイコン・基準線などのマークに使う色 */
  color: string
  /** 行やカードの背景に敷く淡い面 */
  surfaceClass: string
  /** 左端のラベル帯 */
  railClass: string
}

export const STATUS_TOKENS: Record<DiagnosisSeverity, StatusToken> = {
  good: {
    label: "良好",
    Icon: CheckCircle2,
    color: "var(--status-good)",
    surfaceClass: "bg-[var(--status-good)]/8",
    railClass: "bg-[var(--status-good)]",
  },
  warning: {
    label: "注意",
    Icon: AlertTriangle,
    color: "var(--status-warning)",
    surfaceClass: "bg-[var(--status-warning)]/12",
    railClass: "bg-[var(--status-warning)]",
  },
  critical: {
    label: "要対処",
    Icon: OctagonAlert,
    color: "var(--status-critical)",
    surfaceClass: "bg-[var(--status-critical)]/8",
    railClass: "bg-[var(--status-critical)]",
  },
  info: {
    label: "情報",
    Icon: Info,
    color: "var(--muted-foreground)",
    surfaceClass: "bg-muted/40",
    railClass: "bg-muted-foreground/40",
  },
}

/** アイコン＋ラベルのバッジ。テキストは通常のインク色のままにし、色は左のアイコンだけが担う */
export function StatusBadge({ severity }: { severity: DiagnosisSeverity }) {
  const { label, Icon, color } = STATUS_TOKENS[severity]
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium">
      <Icon className="size-3.5" style={{ color }} aria-hidden />
      {label}
    </span>
  )
}
