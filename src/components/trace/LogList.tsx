import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ExecutionLogEntry } from "@/lib/types"

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
          <p className="mt-1 text-xs text-muted-foreground">{log.executed_at}</p>
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
