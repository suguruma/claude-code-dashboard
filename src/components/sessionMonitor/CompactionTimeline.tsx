import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { CompactionEvent } from "@/lib/types"

interface CompactionTimelineProps {
  compactions: CompactionEvent[]
}

export function CompactionTimeline({ compactions }: CompactionTimelineProps) {
  if (compactions.length === 0) {
    return <p className="text-sm text-muted-foreground">このセッションではコンパクションは発生していません。</p>
  }

  return (
    <div className="space-y-1.5">
      {compactions.map((c, idx) => (
        <div key={idx} className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-xs">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span>{format(new Date(c.timestamp), "yyyy-MM-dd HH:mm:ss")}</span>
              <Badge variant="outline">{c.trigger}</Badge>
            </div>
            <p className="text-muted-foreground">
              発生時トークン数 {c.preTokens.toLocaleString()} ／ 所要時間 {(c.durationMs / 1000).toFixed(1)}秒
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
