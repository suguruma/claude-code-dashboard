import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Eye,
  HelpCircle,
  Hourglass,
  OctagonAlert,
  PauseCircle,
  type LucideIcon,
} from "lucide-react"
import type { DesktopSessionStatus } from "@/lib/desktopSessionTypes"

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
  review_ready: { label: "確認待ち", Icon: Eye, color: "var(--status-warning)", estimated: false },
  completed: { label: "完了", Icon: CheckCircle2, color: "var(--status-good)", estimated: false },
  interrupted: { label: "中断の可能性", Icon: PauseCircle, color: "var(--status-warning)", estimated: true },
  waiting: { label: "入力待ち", Icon: Hourglass, color: "var(--muted-foreground)", estimated: false },
  error: { label: "エラー", Icon: AlertTriangle, color: "var(--status-critical)", estimated: false },
  unknown: { label: "不明", Icon: HelpCircle, color: "var(--muted-foreground)", estimated: false },
}

export function DesktopStatusBadge({ status, reason }: { status: DesktopSessionStatus; reason?: string }) {
  const { label, Icon, color, estimated } = STATUS_META[status]
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
