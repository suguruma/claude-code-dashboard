import { Users } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { AssignedAgent } from "@/lib/types"

interface AgentOrgChartProps {
  agents: AssignedAgent[]
  chainOfCommand?: string[]
}

/**
 * 指揮系統の肩書き（chainOfCommand）は指示プロンプトによって「AI社長」が
 * 存在したりしなかったりするため固定文言にせず、無指定ならチーム編成
 * （assigned_agents）だけをフラットに表示する。
 */
export function AgentOrgChart({ agents, chainOfCommand = [] }: AgentOrgChartProps) {
  if (agents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        このタスクでは専門エージェントの追加はありませんでした（1エージェントで完結）。
      </p>
    )
  }

  return (
    <div className="flex flex-col items-center gap-0">
      {chainOfCommand.map((label, idx) => (
        <div key={idx} className="flex flex-col items-center gap-0">
          <OrgNode label={label} isDirector={idx === chainOfCommand.length - 1} />
          <Connector />
        </div>
      ))}
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

function OrgNode({ label, isDirector }: { label: string; isDirector: boolean }) {
  return (
    <div
      className={
        isDirector
          ? "flex items-center gap-2 rounded-full border border-primary bg-primary/5 px-4 py-1.5 text-sm font-medium"
          : "flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm"
      }
    >
      <Users className="size-4" />
      {label}
    </div>
  )
}
