import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SessionProjectSummary } from "@/lib/types"

interface SessionProjectSelectorProps {
  projects: SessionProjectSummary[]
  value: string | null
  onChange: (dirName: string) => void
}

export function SessionProjectSelector({ projects, value, onChange }: SessionProjectSelectorProps) {
  return (
    <Select value={value ?? undefined} onValueChange={(v) => v && onChange(v)} disabled={projects.length === 0}>
      <SelectTrigger className="w-full sm:w-[420px]">
        <SelectValue placeholder="監視対象のプロジェクトを選択" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.dirName} value={p.dirName}>
            <span className="truncate font-mono text-xs">{p.dirName}</span>
            <span className="text-muted-foreground">（{p.sessionCount}セッション）</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
