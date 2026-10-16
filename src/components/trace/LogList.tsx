"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
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

  async function handleDelete(e: React.MouseEvent, taskId: string, taskName: string) {
    e.stopPropagation()
    if (!confirm(`実行ログ "${taskName}" を削除しますか？この操作は取り消せません。`)) return
    setDeletingId(taskId)
    try {
      await onDelete(taskId)
      toast.success("実行ログを削除しました")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-1.5">
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
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
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
            onClick={(e) => handleDelete(e, log.task_id, log.task_name)}
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
