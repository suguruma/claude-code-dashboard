import type { ReactNode } from "react"
import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { TaskRecord } from "@/lib/types"

const STATUS_ICON: Record<string, ReactNode> = {
  completed: <CheckCircle2 className="size-4 text-green-600 dark:text-green-500" />,
  in_progress: <Loader2 className="size-4 text-blue-600 dark:text-blue-500" />,
  pending: <CircleDashed className="size-4 text-muted-foreground" />,
  deleted: <XCircle className="size-4 text-muted-foreground" />,
}

interface TaskItemProps {
  task: TaskRecord
}

export function TaskItem({ task }: TaskItemProps) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border p-3">
      <div className="mt-0.5 shrink-0">
        {STATUS_ICON[task.status] ?? <CircleDashed className="size-4 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p
          className={cn(
            "text-sm font-medium",
            task.status === "completed" && "text-muted-foreground line-through"
          )}
        >
          {task.subject}
        </p>
        {task.description && (
          <p className="text-xs text-muted-foreground">{task.description}</p>
        )}
        {task.blockedBy.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            依存: #{task.blockedBy.join(", #")}
          </p>
        )}
      </div>
    </div>
  )
}
