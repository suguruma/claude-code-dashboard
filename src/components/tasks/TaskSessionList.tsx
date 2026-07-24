import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { TaskSession } from "@/lib/types"

interface TaskSessionListProps {
  sessions: TaskSession[]
  selectedSessionId: string | null
  onSelect: (sessionId: string) => void
}

function completionRate(session: TaskSession): number {
  if (session.tasks.length === 0) return 0
  const completed = session.tasks.filter((t) => t.status === "completed").length
  return Math.round((completed / session.tasks.length) * 100)
}

export function TaskSessionList({ sessions, selectedSessionId, onSelect }: TaskSessionListProps) {
  return (
    <div className="space-y-1.5">
      {sessions.map((session) => {
        const completed = session.tasks.filter((t) => t.status === "completed").length
        return (
          <button
            key={session.sessionId}
            onClick={() => onSelect(session.sessionId)}
            className={cn(
              "w-full space-y-1.5 rounded-md border p-2.5 text-left text-xs transition-colors hover:bg-accent",
              selectedSessionId === session.sessionId && "border-primary bg-accent"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono">{session.sessionId}</span>
              <span className="shrink-0 text-muted-foreground">
                {completed}/{session.tasks.length}
              </span>
            </div>
            <Progress value={completionRate(session)} className="h-1.5" />
          </button>
        )
      })}
    </div>
  )
}
