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

export function DesktopStatusBadge({
  status,
  reason,
  info,
  standby,
}: {
  status: DesktopSessionStatus
  reason?: string
  info?: DesktopNeedsActionInfo | null
  standby?: DesktopStandbyInfo | null
}) {
  const { label, Icon, color, estimated } = statusMetaOf(status, info, standby)
  return (
    <span
      // max-w-full: 狭いカード(組織図の3層目など)で、バッジが枠の外に出ないよう、親の幅までで折り返す。
      // 折り返すときは、アイコン＋ラベル（例「中断の可能性」）をひと塊にして途中で折らず、「（推定）」だけが次の行へ落ちる
      className="inline-flex max-w-full shrink-0 flex-wrap items-center gap-x-1 rounded-full border px-2 py-0.5 text-xs font-medium"
      title={reason}
    >
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <Icon className="size-3.5" style={{ color }} aria-hidden />
        {label}
      </span>
      {estimated && <span className="whitespace-nowrap font-normal text-muted-foreground">（推定）</span>}
    </span>
  )
}
