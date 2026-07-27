import { ShieldAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ProjectConfig } from "@/lib/types"

interface AnalysisProjectSelectorProps {
  projects: ProjectConfig[]
  value: string | null
  onChange: (id: string) => void
}

export function AnalysisProjectSelector({ projects, value, onChange }: AnalysisProjectSelectorProps) {
  const selected = projects.find((p) => p.id === value) ?? null

  return (
    <div className="space-y-1">
      <Select value={value ?? undefined} onValueChange={(v) => v && onChange(v)} disabled={projects.length === 0}>
        <SelectTrigger className="w-full sm:w-[420px]">
          <SelectValue placeholder="分析対象のプロジェクトを選択">
            {(id: string) => projects.find((p) => p.id === id)?.name ?? id}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected && (
        <div className="flex items-center gap-2">
          <p className="truncate font-mono text-xs text-muted-foreground">{selected.path}</p>
          {selected.isGlobalConfig && (
            <Badge variant="destructive" className="shrink-0 gap-1">
              <ShieldAlert className="size-3" />
              グローバル設定
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}
