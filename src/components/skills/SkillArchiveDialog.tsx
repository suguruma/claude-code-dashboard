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
import { RETENTION_ALWAYS_KEEP, RETENTION_MAX_AGE_DAYS, RETENTION_MAX_COUNT } from "@/lib/retention"
import { archiveLocationLabel, sanitizeModelDirName } from "@/lib/skillArchivePaths"
import { SkillMeta } from "@/lib/types"

interface SkillArchiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string | null
  skill: SkillMeta
  onArchive: (dirName: string) => Promise<void>
  onRestore: (dirName: string, model: string, switchBackupAt?: number) => Promise<void>
}

/** 切り替える先。モデル別のアーカイブ、または、その「切り替え前の自動退避」（switchBackupAt つき） */
interface RestoreTarget {
  model: string
  switchBackupAt?: number
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
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null)
  const [restoring, setRestoring] = useState(false)
  // 切り替えの確認の文言。確認を開いた時点の内容で固定する。閉じるアニメーションの間や、切り替え後に現在のモデルが変わっても、文言を組み替えない
  const [restoreDescription, setRestoreDescription] = useState("")

  const currentModel = skill.targetModel ?? ""
  // 上書きの確認が要るのは、モデル別のアーカイブ（1モデルに1件）。「切り替え前の自動退避」は上書きの対象ではない
  const existingVersionForCurrentModel = versions.find(
    (v) => v.model === currentModel && v.switchBackupAt === undefined
  )

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
      await onRestore(skill.dirName, restoreTarget.model, restoreTarget.switchBackupAt)
      toast.success(`「${restoreTarget.model || "モデル未設定"}」版に切り替えました`)
      setRestoreTarget(null)
      await mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "切り替えに失敗しました")
    } finally {
      setRestoring(false)
    }
  }

  const currentLabel = skill.targetModel || "モデル未設定"
  const retentionNote =
    `新しい順に${RETENTION_MAX_COUNT}世代まで残り、${RETENTION_MAX_AGE_DAYS}日を過ぎたものは自動で削除されます` +
    `（直近${RETENTION_ALWAYS_KEEP}世代は残ります）。`

  /** 切り替えの確認の文言。切り替え先が現在と同じモデルかどうかで、現在の内容の行き先が違う */
  function describeRestore(target: RestoreTarget): string {
    const sameModel = sanitizeModelDirName(target.model) === sanitizeModelDirName(currentModel)
    const targetLabel =
      target.switchBackupAt !== undefined
        ? `「${target.model || "モデル未設定"}」の切り替え前の自動退避（${format(new Date(target.switchBackupAt), "yyyy-MM-dd HH:mm:ss")}）`
        : `「${target.model || "モデル未設定"}」のアーカイブ版`
    return sameModel
      ? `${targetLabel}に置き換わります。現在の内容（${currentLabel}）は、切り替える前に「切り替え前の自動退避」としてこの一覧に残るので、後から戻せます。自動退避は${retentionNote}`
      : `${targetLabel}に置き換わります。現在の内容（${currentLabel}）は、そのモデルのアーカイブとして先に退避され、この一覧から後から戻せます。` +
          `そのモデルのアーカイブが既にあるときは上書きされ、古い方は退避フォルダ（${archiveLocationLabel(currentModel, skill.dirName)}.ccd-backup.数字）へ移ります。この退避は画面からは戻せません。退避は${retentionNote}`
  }

  function openRestoreConfirm(target: RestoreTarget) {
    setRestoreDescription(describeRestore(target))
    setRestoreTarget(target)
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
                  key={`${v.model || "(未設定)"}#${v.switchBackupAt ?? ""}`}
                  className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs"
                >
                  <div className="min-w-0 space-x-2">
                    {v.switchBackupAt !== undefined && <Badge variant="secondary">切り替え前の自動退避</Badge>}
                    <Badge variant="outline">{v.model || "モデル未設定"}</Badge>
                    {v.switchBackupAt !== undefined ? (
                      <span className="text-muted-foreground">
                        {format(new Date(v.switchBackupAt), "yyyy-MM-dd HH:mm:ss")}
                      </span>
                    ) : (
                      v.updatedAt && (
                        <span className="text-muted-foreground">{format(new Date(v.updatedAt), "yyyy-MM-dd HH:mm")}</span>
                      )
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0"
                    onClick={() => openRestoreConfirm({ model: v.model, switchBackupAt: v.switchBackupAt })}
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
        description={restoreDescription}
        confirmLabel="切り替える"
        confirming={restoring}
        onConfirm={handleRestoreConfirm}
      />

      <ConfirmDialog
        open={confirmOverwrite}
        onOpenChange={setConfirmOverwrite}
        title="既存のアーカイブを上書きしますか？"
        description={
          `「${currentLabel}」のアーカイブは既に存在します。` +
          "1モデルにつき保存できるアーカイブは1件のみのため、上書きすると既存のアーカイブは" +
          `退避フォルダ（${archiveLocationLabel(currentModel, skill.dirName)}.ccd-backup.数字）へ移り、この画面からは戻せなくなります。` +
          `退避は${retentionNote}戻す必要があるときは、退避フォルダの名前を元に戻してください。`
        }
        confirmLabel="上書きする"
        confirming={archiving}
        onConfirm={runArchive}
      />
    </>
  )
}
