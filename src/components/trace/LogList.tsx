"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"
import { ExecutionLogEntry, ExecutionLogStatus } from "@/lib/types"

interface LogListProps {
  logs: ExecutionLogEntry[]
  selectedTaskId: string | null
  onSelect: (taskId: string) => void
  onDelete: (taskId: string) => Promise<void>
}

function scoreVariant(score: number): "default" | "secondary" | "destructive" {
  if (score >= 90) return "default"
  if (score >= 60) return "secondary"
  return "destructive"
}

const STATUS_LABEL: Record<ExecutionLogStatus, string> = {
  completed: "完了",
  in_progress: "進行中",
  failed: "失敗",
}

const STATUS_VARIANT: Record<ExecutionLogStatus, "secondary" | "destructive"> = {
  completed: "secondary",
  in_progress: "secondary",
  failed: "destructive",
}

export function LogList({ logs, selectedTaskId, onSelect, onDelete }: LogListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ taskId: string; taskName: string } | null>(null)

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeletingId(deleteTarget.taskId)
    try {
      await onDelete(deleteTarget.taskId)
      toast.success("実行ログを削除しました（「設定 & システム情報」のバックアップから戻せます）")
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-1.5">
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="実行ログを削除しますか？"
        description={
          <>
            「{deleteTarget?.taskName}」を execution_log.json から削除します。削除前の execution_log.json は自動で
            バックアップされ、「設定 & システム情報」の「バックアップ」から元に戻せます。
          </>
        }
        confirmLabel="削除する"
        confirming={deletingId !== null}
        onConfirm={handleConfirmDelete}
      />
      {logs.map((log) => (
        <div
          key={log.task_id}
          className={cn(
            "group relative rounded-md border transition-colors hover:bg-accent",
            selectedTaskId === log.task_id && "border-primary bg-accent"
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(log.task_id)}
            className="w-full p-3 pr-8 text-left text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium leading-snug">{log.task_name}</span>
              <Badge variant={scoreVariant(log.one_shot_score)} className="shrink-0">
                {log.one_shot_score}点
              </Badge>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <p className="text-xs text-muted-foreground">{log.executed_at}</p>
              {log.status && log.status !== "completed" && (
                <Badge variant={STATUS_VARIANT[log.status]} className="text-[10px]">
                  {STATUS_LABEL[log.status]}
                </Badge>
              )}
            </div>
            {log.user_interventions.length > 0 && (
              <p className="mt-1 text-xs text-[var(--status-critical-text)]">
                介入 {log.user_interventions.length}件
              </p>
            )}
            {log.skill_names && log.skill_names.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {log.skill_names.map((name) => (
                  <Badge key={name} variant="outline" className="text-[10px] font-normal">
                    {name}
                  </Badge>
                ))}
              </div>
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setDeleteTarget({ taskId: log.task_id, taskName: log.task_name })
            }}
            disabled={deletingId === log.task_id}
            aria-label="この実行ログを削除"
            className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
