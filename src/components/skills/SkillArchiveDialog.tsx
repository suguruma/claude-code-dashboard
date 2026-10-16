"use client"

import { useState } from "react"
import { Archive, ArchiveRestore } from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useSkillArchiveVersions } from "@/hooks/useSkills"
import { SkillMeta } from "@/lib/types"

interface SkillArchiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string | null
  skill: SkillMeta
  onArchive: (dirName: string) => Promise<void>
  onRestore: (dirName: string, model: string) => Promise<void>
}

export function SkillArchiveDialog({
  open,
  onOpenChange,
  projectId,
  skill,
  onArchive,
  onRestore,
}: SkillArchiveDialogProps) {
  const { versions, isLoading, mutate } = useSkillArchiveVersions(
    open ? projectId : null,
    open ? skill.dirName : null
  )
  const [archiving, setArchiving] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  const currentModel = skill.targetModel ?? ""
  const existingVersionForCurrentModel = versions.find((v) => v.model === currentModel)

  async function runArchive() {
    setArchiving(true)
    try {
      await onArchive(skill.dirName)
      toast.success(`現在のバージョン（${skill.targetModel || "モデル未設定"}）をアーカイブしました`)
      await mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "アーカイブに失敗しました")
    } finally {
      setArchiving(false)
      setConfirmOverwrite(false)
    }
  }

  function handleArchiveClick() {
    if (existingVersionForCurrentModel) {
      setConfirmOverwrite(true)
      return
    }
    void runArchive()
  }

  async function handleRestoreConfirm() {
    if (restoreTarget === null) return
    setRestoring(true)
    try {
      await onRestore(skill.dirName, restoreTarget)
      toast.success(`「${restoreTarget || "モデル未設定"}」版に切り替えました`)
      setRestoreTarget(null)
      await mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "切り替えに失敗しました")
    } finally {
      setRestoring(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>モデル別アーカイブ — {skill.title || skill.dirName}</DialogTitle>
            <DialogDescription>
              現在アクティブなバージョン（対象モデル: {skill.targetModel || "未設定"}）を退避したり、
              過去にアーカイブしたモデル別バージョンに切り替えたりできます。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Button variant="outline" size="sm" onClick={handleArchiveClick} disabled={archiving}>
              <Archive className="size-3.5" />
              {archiving ? "アーカイブ中..." : "現在のバージョンをアーカイブする"}
            </Button>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">アーカイブ済みバージョン</p>
              {isLoading && <p className="text-xs text-muted-foreground">読み込み中...</p>}
              {!isLoading && versions.length === 0 && (
                <p className="text-xs text-muted-foreground">まだアーカイブがありません。</p>
              )}
              {versions.map((v) => (
                <div
                  key={v.model || "(未設定)"}
                  className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs"
                >
                  <div className="min-w-0">
                    <Badge variant="outline">{v.model || "モデル未設定"}</Badge>
                    {v.updatedAt && (
                      <span className="ml-2 text-muted-foreground">
                        {format(new Date(v.updatedAt), "yyyy-MM-dd HH:mm")}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0"
                    onClick={() => setRestoreTarget(v.model)}
                  >
                    <ArchiveRestore className="size-3.5" />
                    このバージョンに切り替える
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              閉じる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        title="バージョンを切り替えますか？"
        description={
          <>
            現在アクティブな内容（{skill.targetModel || "モデル未設定"}）はアーカイブへ退避されたうえで、
            「{restoreTarget || "モデル未設定"}」のアーカイブ版に置き換わります。退避された内容は後からいつでも戻せます。
          </>
        }
        confirmLabel="切り替える"
        confirming={restoring}
        onConfirm={handleRestoreConfirm}
      />

      <ConfirmDialog
        open={confirmOverwrite}
        onOpenChange={setConfirmOverwrite}
        title="既存のアーカイブを上書きしますか？"
        description={
          <>
            「{skill.targetModel || "モデル未設定"}」のアーカイブは既に存在します。1モデルにつき保存できる
            アーカイブは1件のみのため、上書きすると既存のアーカイブ内容は失われます。
          </>
        }
        confirmLabel="上書きする"
        confirming={archiving}
        onConfirm={runArchive}
      />
    </>
  )
}
