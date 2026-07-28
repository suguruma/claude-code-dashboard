import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { SessionSummary } from "@/lib/types"

interface SessionListProps {
  sessions: SessionSummary[]
  selectedSessionId: string | null
  onSelect: (sessionId: string) => void
}

export function SessionList({ sessions, selectedSessionId, onSelect }: SessionListProps) {
  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">セッションが見つかりません。</p>
  }

  return (
    <div className="space-y-1.5">
      {sessions.map((s) => (
        <button
          key={s.sessionId}
          type="button"
          onClick={() => onSelect(s.sessionId)}
          className={cn(
            "w-full rounded-md border p-2.5 text-left text-xs transition-colors hover:border-primary",
            selectedSessionId === s.sessionId && "border-primary bg-accent"
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">
              {s.firstUserMessageExcerpt || "（発話内容なし）"}
            </span>
            {s.toolErrorCount > 0 && (
              <Badge variant="destructive" className="shrink-0">
                エラー{s.toolErrorCount}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
            {s.sessionId}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
            <span>{s.startedAt ? format(new Date(s.startedAt), "yyyy-MM-dd HH:mm") : "日時不明"}</span>
            <span>ターン数 {s.turnCount}</span>
            <span>ツール {s.toolCallCount}回</span>
            <span>
              トークン {(s.totalInputTokens + s.totalOutputTokens).toLocaleString()}
            </span>
            {s.compactionCount > 0 && <span>コンパクション{s.compactionCount}回</span>}
          </div>
          {s.skillNames.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {s.skillNames.map((name) => (
                <Badge key={name} variant="outline" className="text-[10px] font-normal">
                  {name}
                </Badge>
              ))}
            </div>
          )}
        </button>
      ))}
    </div>
  )
}
