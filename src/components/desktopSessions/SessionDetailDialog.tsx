"use client"

import Link from "next/link"
import { CheckCircle2, Circle, CircleDot, ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useDesktopSessionDetail } from "@/hooks/useDesktopSessions"
import { isInstructionProvisional } from "@/lib/desktopInstruction"
import type { TaskStatus } from "@/lib/desktopSessionTypes"
import { cn } from "@/lib/utils"
import { ContextBar } from "./ContextBar"
import { InstructionPendingBadge } from "./InstructionPendingBadge"
import { SendCountBadge, SendLimitNotice } from "./Messaging"
import { DesktopStatusBadge } from "./statusMeta"
import { ORIGIN_LABEL, formatAgo, formatDateTime } from "./format"

const TASK_ICON: Record<TaskStatus, { Icon: typeof Circle; label: string; className: string }> = {
  completed: { Icon: CheckCircle2, label: "完了", className: "text-[var(--status-good)]" },
  in_progress: { Icon: CircleDot, label: "実行中", className: "text-primary" },
  pending: { Icon: Circle, label: "未着手", className: "text-muted-foreground" },
}

interface SessionDetailDialogProps {
  sessionId: string | null
  highContextRatio: number
  onClose: () => void
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  )
}

export function SessionDetailDialog({ sessionId, highContextRatio, onClose }: SessionDetailDialogProps) {
  const { detail, error, isLoading } = useDesktopSessionDetail(sessionId)
  // 起動直後の暫定の要約のあいだ、人以外の指示の本文は確定した値ではない
  const provisional = detail ? isInstructionProvisional(detail) : false

  return (
    <Dialog open={sessionId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-8">{detail?.title ?? "セッション詳細"}</DialogTitle>
          <DialogDescription>
            Claude Desktopが保存しているセッション情報と会話ログから表示しています（読み取り専用）。
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {!detail && !error && isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}

        {detail && (
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <DesktopStatusBadge status={detail.status} />
                {detail.group && <Badge variant="secondary">{detail.group.name}</Badge>}
                <SendCountBadge messaging={detail.messaging} />
              </div>
              <p className="text-xs text-muted-foreground">判断の根拠：{detail.statusReason}</p>
            </div>

            <SendLimitNotice sessionId={detail.id} messaging={detail.messaging} />

            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="作業フォルダ">
                <span title={detail.cwd ?? undefined}>{detail.cwd ?? "—"}</span>
              </Field>
              <Field label="モデル">{detail.model ?? "—"}</Field>
              <Field label="エフォート / 権限モード">
                {detail.effort ?? "—"} / {detail.permissionMode ?? "—"}
              </Field>
              <Field label="ターン数">{detail.completedTurns ?? "—"}</Field>
              <Field label="作成">{formatDateTime(detail.createdAt)}</Field>
              <Field label="最終活動">
                {formatDateTime(detail.lastActivityAt)}（{formatAgo(detail.lastActivityAt)}）
              </Field>
              <Field label="コンテキストの圧縮">
                {detail.compactionCount === null
                  ? "解析中"
                  : `${detail.compactionCount}回${detail.lastCompactionAt ? `（直近 ${formatAgo(detail.lastCompactionAt)}）` : ""}`}
              </Field>
              <Field label="待機中の入力">{detail.queuedInputs}件</Field>
              <Field label="他のセッションへの送信（人の最後の入力から）">
                {detail.messaging ? (
                  <span title="人が最後に入力してから、他のセッションへ送った回数（届かなかった送信を含む）">
                    {detail.messaging.sent}
                    {detail.messaging.exact ? "" : "以上"} / {detail.messaging.limit}回
                    {detail.messaging.undelivered > 0 && `（未達${detail.messaging.undelivered}件）`}
                  </span>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="CLIプロセス">
                {detail.cliProcess === "running"
                  ? "あり（--resume で起動中。「実行中」とは別の情報）"
                  : detail.cliProcess === "none"
                    ? "なし"
                    : "確認できていません"}
              </Field>
            </dl>

            <div className="space-y-1">
              <h3 className="text-sm font-medium">コンテキスト使用量</h3>
              <ContextBar context={detail.context} highRatio={highContextRatio} showNote />
            </div>

            {detail.needsActionExcerpt && (
              <div className="space-y-1">
                <h3 className="text-sm font-medium">要対応の内容</h3>
                <p className="text-sm">{detail.needsActionExcerpt}</p>
                <p className="text-[11px] text-muted-foreground">
                  Desktopが書いた要約の先頭60文字のみです。会話の本文は表示しません。
                </p>
              </div>
            )}

            <div className="space-y-1">
              <h3 className="text-sm font-medium">最新の指示</h3>
              {detail.latestInstruction ? (
                <p className={cn("text-sm", provisional && "text-muted-foreground")}>
                  <Badge variant="outline" className="mr-1.5">
                    {ORIGIN_LABEL[detail.latestInstruction.origin]}
                  </Badge>
                  {provisional && (
                    <span className="mr-1.5 inline-flex align-middle">
                      <InstructionPendingBadge />
                    </span>
                  )}
                  {detail.latestInstruction.excerpt || "（本文なし）"}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {formatAgo(detail.latestInstruction.at)}
                  </span>
                </p>
              ) : provisional ? (
                <p className="text-sm text-muted-foreground">
                  <InstructionPendingBadge />
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">表示できる指示がありません。</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                会話の本文は表示しません。先頭60文字の抜粋のみです。
              </p>
            </div>

            <div className="space-y-1">
              <h3 className="text-sm font-medium">
                タスクリスト
                {detail.phase && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                    {detail.phase.completed}/{detail.phase.total} 完了
                  </span>
                )}
              </h3>
              {detail.tasks.length > 0 ? (
                <ul className="space-y-1">
                  {detail.tasks.map((task, index) => {
                    const { Icon, label, className } = TASK_ICON[task.status]
                    return (
                      <li key={index} className="flex items-start gap-2 text-sm">
                        <Icon className={`mt-0.5 size-4 shrink-0 ${className}`} aria-label={label} />
                        <span className={task.status === "completed" ? "text-muted-foreground" : undefined}>
                          {task.content || "（名称なし）"}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {detail.digest === "partial"
                    ? "会話ログを全体解析中です。しばらくお待ちください。"
                    : "タスクリストはありません。"}
                </p>
              )}
            </div>

            {detail.projectDirName && detail.transcriptId && (
              <Link
                href={`/session-monitor?dir=${encodeURIComponent(detail.projectDirName)}&session=${encodeURIComponent(detail.transcriptId)}`}
                className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                セッション監視で詳しく診断する
              </Link>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
