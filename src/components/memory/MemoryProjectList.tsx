import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { MemoryProject } from "@/lib/types"

interface MemoryProjectListProps {
  projects: MemoryProject[]
  selectedDirName: string | null
  onSelect: (dirName: string) => void
}

export function MemoryProjectList({ projects, selectedDirName, onSelect }: MemoryProjectListProps) {
  return (
    <div className="space-y-1.5">
      {projects.map((p) => (
        <button
          key={p.dirName}
          onClick={() => onSelect(p.dirName)}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md border p-2.5 text-left text-xs transition-colors hover:bg-accent",
            selectedDirName === p.dirName && "border-primary bg-accent"
          )}
        >
          <span className="truncate font-mono">{p.dirName}</span>
          <Badge variant="secondary" className="shrink-0">
            {p.entryCount}
          </Badge>
        </button>
      ))}
    </div>
  )
}
