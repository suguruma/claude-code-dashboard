import { Badge } from "@/components/ui/badge"

interface SkillSubagentUsageProps {
  skillCallCounts: Record<string, number>
  subagentCallCounts: Record<string, number>
}

function CountList({ counts, empty }: { counts: Record<string, number>; empty: string }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([name, count]) => (
        <Badge key={name} variant="secondary">
          {name} × {count}
        </Badge>
      ))}
    </div>
  )
}

/** 発火したスキル名・起動したサブエージェント種別(subagent_type)を件数付きで一覧表示する */
export function SkillSubagentUsage({ skillCallCounts, subagentCallCounts }: SkillSubagentUsageProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">発火したスキル</p>
        <CountList counts={skillCallCounts} empty="スキルの発火はありません。" />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">起動したサブエージェント</p>
        <CountList counts={subagentCallCounts} empty="サブエージェントの起動はありません。" />
      </div>
    </div>
  )
}
