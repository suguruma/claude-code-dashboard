import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  HelpCircle,
  Hourglass,
  KeyRound,
  MessageCircleQuestionMark,
  OctagonAlert,
  PauseCircle,
  Stamp,
  type LucideIcon,
} from "lucide-react"
import type { DesktopNeedsActionInfo, DesktopSessionStatus, DesktopStandbyInfo } from "@/lib/desktopSessionTypes"
import { NEEDS_ACTION_KIND_LABEL, type NeedsActionKind } from "@/lib/needsActionKind"
import { markOfStatus, type MarkTone, type StatusMark } from "@/lib/statusMark"
import { useStatusMarks } from "@/hooks/useStatusMarks"

interface StatusMeta {
  label: string
  Icon: LucideIcon
  /** アイコンの色。色だけに頼らず、必ずアイコンの形とラベルを併記する */
  color: string
  /** 推定による表示かどうか(ラベルに注記する) */
  estimated: boolean
}

export const STATUS_META: Record<DesktopSessionStatus, StatusMeta> = {
  running: { label: "実行中", Icon: Activity, color: "var(--primary)", estimated: true },
  blocked: { label: "要対応", Icon: OctagonAlert, color: "var(--status-critical)", estimated: false },
  standby: { label: "待機", Icon: Clock, color: "var(--muted-foreground)", estimated: false },
  review_ready: { label: "確認待ち", Icon: Eye, color: "var(--status-warning)", estimated: false },
  completed: { label: "完了", Icon: CheckCircle2, color: "var(--status-good)", estimated: false },
  interrupted: { label: "中断の可能性", Icon: PauseCircle, color: "var(--status-warning)", estimated: true },
  waiting: { label: "入力待ち", Icon: Hourglass, color: "var(--muted-foreground)", estimated: false },
  error: { label: "エラー", Icon: AlertTriangle, color: "var(--status-critical)", estimated: false },
  unknown: { label: "不明", Icon: HelpCircle, color: "var(--muted-foreground)", estimated: false },
}

/** 要対応の種類ごとのアイコン(⑩)。色は要対応の赤のまま、形と文字で見分ける */
export const NEEDS_ACTION_ICON: Record<NeedsActionKind, LucideIcon> = {
  permission: KeyRound,
  approval: Stamp,
  decision: MessageCircleQuestionMark,
  unknown: OctagonAlert,
}

/**
 * 状態の表示。要対応は、種類が分かっていれば種類の名前とアイコンにする(言葉からの推定なら「推定」を添える)。
 * 待機も、言葉から決めたものは「推定」を添える
 */
export function statusMetaOf(
  status: DesktopSessionStatus,
  info?: DesktopNeedsActionInfo | null,
  standby?: DesktopStandbyInfo | null
): StatusMeta {
  const base = STATUS_META[status]
  if (status === "standby") return { ...base, estimated: standby?.estimated ?? false }
  if (status !== "blocked" || !info) return base
  return { ...base, label: NEEDS_ACTION_KIND_LABEL[info.kind], Icon: NEEDS_ACTION_ICON[info.kind], estimated: info.estimated }
}

/** 印の色(⑮ OR-2。要件メモ 4-2 の色の意味表)。枠は線の色、文字は 4.5:1 以上の -text の色(琥珀を文字の色にしない) */
const TONE_CLASS: Record<MarkTone, string> = {
  red: "border-[var(--status-critical)] text-[var(--status-critical-text)]",
  amber: "border-[var(--status-warning)] text-[var(--status-warning-text)]",
  green: "border-[var(--status-good)] text-[var(--status-good-text)]",
  blue: "border-[var(--status-info)] text-[var(--status-info-text)]",
  gray: "border-muted-foreground/50 text-muted-foreground",
}

/**
 * 状態の印の部品(⑮ OR-2)。セッション一覧・組織図のカード・詳細・看板・鐘・探すで同じものを使う。
 * 記号と文字を必ず添え、色だけに頼らない。文字は 14px
 */
export function StatusMarkBadge({ mark, reason, compact = false }: { mark: StatusMark; reason?: string; compact?: boolean }) {
  return (
    <span
      // max-w-full: 狭いカード(組織図の3層目など)で、印が枠の外に出ないよう、親の幅までで折り返す。
      // 折り返すときは、記号＋文字をひと塊にして途中で折らず、「（推定）」だけが次の行へ落ちる
      className={`inline-flex max-w-full shrink-0 flex-wrap items-center gap-x-1 rounded-full border bg-background px-2 text-sm font-medium leading-6 ${TONE_CLASS[mark.tone]}`}
      title={reason}
      data-testid="status-mark"
      data-tone={mark.tone}
    >
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span aria-hidden className="font-bold">
          {mark.symbol}
        </span>
        {compact ? null : mark.text}
        {compact && <span className="sr-only">{mark.text}</span>}
      </span>
      {mark.estimated && !compact && <span className="whitespace-nowrap font-normal text-muted-foreground">（推定）</span>}
    </span>
  )
}

/**
 * セッションの状態の印。一覧から決めた印(判断の段の色を含む)を使い、一覧にまだ無いときだけ状態から決める
 */
export function DesktopStatusBadge({
  id,
  status,
  reason,
  standby,
}: {
  id: string
  status: DesktopSessionStatus
  reason?: string
  standby?: DesktopStandbyInfo | null
}) {
  const marks = useStatusMarks()
  const mark = marks?.get(id) ?? markOfStatus({ status, standbyInfo: standby ?? null })
  return <StatusMarkBadge mark={mark} reason={reason} />
}
