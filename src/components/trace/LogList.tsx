import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ExecutionLogEntry, ExecutionLogStatus } from "@/lib/types"

interface LogListProps {
  logs: ExecutionLogEntry[]
  selectedTaskId: string | null
  onSelect: (taskId: string) => void
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

export function LogList({ logs, selectedTaskId, onSelect }: LogListProps) {
  return (
    <div className="space-y-1.5">
      {logs.map((log) => (
        <button
          key={log.task_id}
          onClick={() => onSelect(log.task_id)}
          className={cn(
            "w-full rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent",
            selectedTaskId === log.task_id && "border-primary bg-accent"
          )}
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
        </button>
      ))}
    </div>
  )
}
