import { Crown, User, type LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { AssignedAgent } from "@/lib/types"

interface AgentOrgChartProps {
  agents: AssignedAgent[]
}

/**
 * 「オーナー→AI社長→専門エージェント」の最大2階層ガードレールをそのまま構造化した
 * 固定2階層のフラットな構成図。専門エージェントの中にさらに専門エージェントを持つ
 * 3階層目は、ガードレール上そもそも許容されないためスキーマ・UIとも対応しない。
 */
export function AgentOrgChart({ agents }: AgentOrgChartProps) {
  if (agents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        このタスクでは専門エージェントの追加はありませんでした（AI社長が単独で完結）。
      </p>
    )
  }

  return (
    <div className="flex flex-col items-center gap-0">
      <OrgNode icon={User} label="オーナー" />
      <Connector />
      <OrgNode icon={Crown} label="AI社長（メインディレクター）" highlight />
      <Connector />
      <div className="flex flex-wrap justify-center gap-3">
        {agents.map((agent, idx) => (
          <Card key={idx} className="w-56 gap-0 py-3">
            <CardContent className="space-y-1 px-3">
              <p className="text-sm font-medium">{agent.role}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {agent.reason_for_assignment}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function Connector() {
  return <div className="h-4 w-px bg-border" />
}

function OrgNode({
  icon: Icon,
  label,
  highlight,
}: {
  icon: LucideIcon
  label: string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm",
        highlight && "border-primary bg-primary/5 font-medium"
      )}
    >
      <Icon className="size-4" />
      {label}
    </div>
  )
}
