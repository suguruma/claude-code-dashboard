import { BookOpen, Radio, UserCog, Users, Wrench, type LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
          <AgentCard key={idx} agent={agent} />
        ))}
      </div>
    </div>
  )
}

function AgentCard({ agent }: { agent: AssignedAgent }) {
  const hasDetails = agent.persona || agent.memory_context || agent.tools?.length || agent.current_state

  return (
    <Card className="w-64 gap-0 py-3">
      <CardContent className="space-y-2 px-3">
        <div>
          <p className="text-sm font-medium">{agent.role}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{agent.reason_for_assignment}</p>
        </div>
        {hasDetails && (
          <div className="space-y-1.5 border-t pt-2">
            {agent.persona && <DetailRow icon={UserCog} label="役割・制約" text={agent.persona} />}
            {agent.memory_context && <DetailRow icon={BookOpen} label="記憶・文脈" text={agent.memory_context} />}
            {agent.tools && agent.tools.length > 0 && (
              <div className="flex items-start gap-1.5">
                <Wrench className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                <div className="flex flex-wrap gap-1">
                  {agent.tools.map((tool, idx) => (
                    <Badge key={idx} variant="outline" className="text-[10px]">
                      {tool}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {agent.current_state && <DetailRow icon={Radio} label="状態" text={agent.current_state} />}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DetailRow({ icon: Icon, label, text }: { icon: LucideIcon; label: string; text: string }) {
  return (
    <div className="flex items-start gap-1.5 text-xs">
      <Icon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
      <p className="leading-relaxed text-muted-foreground">
        <span className="text-foreground/70">{label}: </span>
        {text}
      </p>
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
