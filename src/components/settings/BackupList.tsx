import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { BackupEntry } from "@/lib/types"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface BackupListProps {
  backups: BackupEntry[]
}

export function BackupList({ backups }: BackupListProps) {
  if (backups.length === 0) {
    return <p className="text-sm text-muted-foreground">バックアップが見つかりません。</p>
  }

  return (
    <div className="space-y-1.5">
      {backups.map((backup) => (
        <div
          key={backup.fileName}
          className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-xs"
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate font-mono">{backup.fileName}</p>
            <p className="text-muted-foreground">
              {backup.timestampMs
                ? format(new Date(backup.timestampMs), "yyyy-MM-dd HH:mm:ss")
                : "日時不明"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {backup.fileName.includes("corrupted") && (
              <Badge variant="destructive">corrupted</Badge>
            )}
            <span className="text-muted-foreground">{formatBytes(backup.sizeBytes)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
