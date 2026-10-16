import { useState } from "react"
import { format } from "date-fns"
import { toast } from "sonner"
import { History } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { BackupEntry } from "@/lib/types"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface BackupListProps {
  backups: BackupEntry[]
  isGlobalConfig?: boolean
  onRestore: (fileName: string) => Promise<void>
}

export function BackupList({ backups, isGlobalConfig, onRestore }: BackupListProps) {
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  if (backups.length === 0) {
    return <p className="text-sm text-muted-foreground">バックアップが見つかりません。</p>
  }

  async function handleConfirmRestore() {
    if (!restoreTarget) return
    setRestoring(true)
    try {
      await onRestore(restoreTarget)
      toast.success("バックアップから復元しました")
      setRestoreTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "復元に失敗しました")
    } finally {
      setRestoring(false)
    }
  }

  return (
    <>
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
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => setRestoreTarget(backup.fileName)}
              >
                <History className="size-3.5" />
                復元する
              </Button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        title="このバックアップから復元しますか？"
        description={
          <>
            「{restoreTarget}」の内容で .claude.json を上書きします。
            {isGlobalConfig && (
              <span className="mt-1 block font-medium text-destructive">
                実際の Claude Code のセッション/信頼設定が書き換わります。
              </span>
            )}
            現在の .claude.json は復元前に自動でバックアップされます。
          </>
        }
        confirmLabel="復元する"
        confirming={restoring}
        onConfirm={handleConfirmRestore}
      />
    </>
  )
}
