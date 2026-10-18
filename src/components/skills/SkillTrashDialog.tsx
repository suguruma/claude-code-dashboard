"use client"

import { useState } from "react"
import { ArchiveRestore } from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RETENTION_ALWAYS_KEEP, RETENTION_MAX_AGE_DAYS, RETENTION_MAX_COUNT } from "@/lib/retention"
import { TrashedSkill } from "@/lib/types"

interface SkillTrashDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: TrashedSkill[]
  trashPath: string | null
  isLoading: boolean
  onRestore: (id: string) => Promise<void>
}

export function SkillTrashDialog({
  open,
  onOpenChange,
  items,
  trashPath,
  isLoading,
  onRestore,
}: SkillTrashDialogProps) {
  const [restoringId, setRestoringId] = useState<string | null>(null)

  async function handleRestore(item: TrashedSkill) {
    setRestoringId(item.id)
    try {
      await onRestore(item.id)
      toast.success(`スキル "${item.dirName}" を復元しました`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "復元に失敗しました")
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>削除済みスキル</DialogTitle>
          <DialogDescription>
            削除したスキルは、完全には消さずに退避フォルダへ移しています。ここから元に戻せます。
            同じスキルの退避は新しい順に{RETENTION_MAX_COUNT}件まで、{RETENTION_MAX_AGE_DAYS}
            日より古いものは自動で削除されます（直近{RETENTION_ALWAYS_KEEP}件は期間にかかわらず残ります）。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {isLoading && <p className="text-xs text-muted-foreground">読み込み中...</p>}
          {!isLoading && items.length === 0 && (
            <p className="text-xs text-muted-foreground">削除済みのスキルはありません。</p>
          )}
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="truncate font-medium">{item.title || item.dirName}</p>
                <p className="truncate font-mono text-muted-foreground">{item.id}</p>
                <p className="text-muted-foreground">
                  {format(new Date(item.deletedAt), "yyyy-MM-dd HH:mm")} に削除
                  {!item.wasEnabled && (
                    <Badge variant="outline" className="ml-2">
                      削除時は無効
                    </Badge>
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0"
                disabled={restoringId !== null}
                onClick={() => handleRestore(item)}
              >
                <ArchiveRestore className="size-3.5" />
                {restoringId === item.id ? "復元中..." : "復元する"}
              </Button>
            </div>
          ))}
        </div>

        {trashPath && (
          <p className="break-all text-xs text-muted-foreground">
            退避先: <span className="font-mono">{trashPath}</span>
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
