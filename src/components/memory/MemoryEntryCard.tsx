import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MemoryEntry } from "@/lib/types"
import { cn } from "@/lib/utils"

const TYPE_STYLES: Record<string, string> = {
  user: "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-400",
  feedback: "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
  project: "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400",
  reference: "border-purple-300 text-purple-700 dark:border-purple-800 dark:text-purple-400",
}

interface MemoryEntryCardProps {
  entry: MemoryEntry
}

export function MemoryEntryCard({ entry }: MemoryEntryCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-mono">{entry.name}</CardTitle>
        <Badge variant="outline" className={cn("shrink-0", TYPE_STYLES[entry.type])}>
          {entry.type}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">{entry.description}</p>
        {entry.body && (
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed">
            {entry.body}
          </pre>
        )}
      </CardContent>
    </Card>
  )
}
