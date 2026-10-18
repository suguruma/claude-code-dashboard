import { useState } from "react"
import { format } from "date-fns"
import { toast } from "sonner"
import { History } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { RETENTION_ALWAYS_KEEP, RETENTION_MAX_AGE_DAYS, RETENTION_MAX_COUNT } from "@/lib/retention"
import { BackupEntry, BackupKind } from "@/lib/types"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface BackupSection {
  kind: BackupKind
  title: string
  note: string
  entries: BackupEntry[]
}

interface BackupListProps {
  backups: BackupEntry[]
  isGlobalConfig?: boolean
  onRestore: (fileName: string, kind: BackupKind) => Promise<void>
}

export function BackupList({ backups, isGlobalConfig, onRestore }: BackupListProps) {
  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null)
  const [restoring, setRestoring] = useState(false)

  if (backups.length === 0) {
    return <p className="text-sm text-muted-foreground">バックアップが見つかりません。</p>
  }

  async function handleConfirmRestore() {
    if (!restoreTarget) return
    setRestoring(true)
    try {
      await onRestore(restoreTarget.fileName, restoreTarget.kind)
      toast.success("バックアップから復元しました")
      setRestoreTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "復元に失敗しました")
    } finally {
      setRestoring(false)
    }
  }

  const allSections: BackupSection[] = [
    {
      kind: "ccd",
      title: "このダッシュボードの退避（編集・削除の直前）",
      note: `ルール(CLAUDE.md)・設定・実行ログなどを書き換える・削除する直前の内容です。同じファイルにつき新しい順に${RETENTION_MAX_COUNT}世代まで、${RETENTION_MAX_AGE_DAYS}日より古いものは自動で削除されます（直近${RETENTION_ALWAYS_KEEP}世代は期間にかかわらず残ります）。`,
      entries: backups.filter((b) => b.kind === "ccd"),
    },
    {
      kind: "claude-json",
      title: "Claude Code の自動バックアップ（.claude.json）",
      note: "Claude Code 本体が backups/ に作るバックアップです。",
      entries: backups.filter((b) => b.kind === "claude-json"),
    },
  ]
  const sections = allSections.filter((s) => s.entries.length > 0)

  const restoreTargetName =
    restoreTarget?.kind === "ccd" ? (restoreTarget.originalName ?? "元のファイル") : ".claude.json"

  return (
    <>
      <div className="space-y-5">
        {sections.map((section) => (
          <section key={section.kind} className="space-y-1.5">
            <div>
              <h2 className="text-sm font-medium">{section.title}</h2>
              <p className="text-xs text-muted-foreground">{section.note}</p>
            </div>
            {section.entries.map((backup) => (
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
                    onClick={() => setRestoreTarget(backup)}
                  >
                    <History className="size-3.5" />
                    復元する
                  </Button>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        title="このバックアップから復元しますか？"
        description={
          <>
            「{restoreTarget?.fileName}」の内容で {restoreTargetName} を上書きします。
            {isGlobalConfig && (
              <span className="mt-1 block font-medium text-destructive">
                {restoreTarget?.kind === "ccd"
                  ? "実際の Claude Code の設定ファイルが書き換わります。"
                  : "実際の Claude Code のセッション/信頼設定が書き換わります。"}
              </span>
            )}
            現在の {restoreTargetName} は復元前に自動でバックアップされます。
          </>
        }
        confirmLabel="復元する"
        confirming={restoring}
        onConfirm={handleConfirmRestore}
      />
    </>
  )
}
