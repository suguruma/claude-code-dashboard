"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ExecutionLogEntry } from "@/lib/types"

interface PromptSummaryCardProps {
  entry: ExecutionLogEntry
}

export function PromptSummaryCard({ entry }: PromptSummaryCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="truncate">{entry.task_name}</span>
          <Badge variant="secondary" className="shrink-0">
            1-Shot {entry.one_shot_score}点
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed font-mono">
          {entry.next_golden_prompt}
        </pre>
      </CardContent>
    </Card>
  )
}
