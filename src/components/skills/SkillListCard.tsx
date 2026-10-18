"use client"

import { useState } from "react"
import { Archive, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SkillArchiveDialog } from "@/components/skills/SkillArchiveDialog"
import { SkillMeta } from "@/lib/types"
import { cn } from "@/lib/utils"

interface SkillListCardProps {
  skill: SkillMeta
  projectId: string | null
  onEdit: (skill: SkillMeta) => void
  onDelete: (dirName: string) => Promise<void>
  onArchive: (dirName: string) => Promise<void>
  onRestore: (dirName: string, model: string) => Promise<void>
  onToggleEnabled: (dirName: string, enabled: boolean) => Promise<void>
}

export function SkillListCard({
  skill,
  projectId,
  onEdit,
  onDelete,
  onArchive,
  onRestore,
  onToggleEnabled,
}: SkillListCardProps) {
  const [busy, setBusy] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  async function handleDelete() {
    setBusy(true)
    try {
      await onDelete(skill.dirName)
      toast.success("スキルを削除しました（「削除済みスキル」から復元できます）")
      setDeleteConfirmOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました")
    } finally {
      setBusy(false)
    }
  }

  async function handleToggle(checked: boolean) {
    setToggling(true)
    try {
      await onToggleEnabled(skill.dirName, checked)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新に失敗しました")
    } finally {
      setToggling(false)
    }
  }

  return (
    <Card className={cn(!skill.enabled && "opacity-60")}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-sm">{skill.title || skill.dirName}</CardTitle>
          {skill.title && (
            <p className="truncate font-mono text-xs text-muted-foreground">{skill.dirName}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex flex-wrap justify-end gap-1">
            {skill.targetModel && <Badge variant="outline">🎯 {skill.targetModel}</Badge>}
            {skill.argumentSchema !== undefined && <Badge variant="outline">引数あり</Badge>}
            {skill.hasReferences && <Badge variant="secondary">📎 references</Badge>}
            {skill.hasScripts && <Badge variant="secondary">🔧 scripts</Badge>}
            {skill.hasEvals && <Badge variant="secondary">✅ evals</Badge>}
          </div>
          <Tooltip>
            <TooltipTrigger render={<div />}>
              <Switch checked={skill.enabled} disabled={toggling} onCheckedChange={handleToggle} />
            </TooltipTrigger>
            <TooltipContent>
              {skill.enabled ? "有効（Claude Codeから呼び出し可能）" : "無効（呼び出し不可）"}
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">{skill.description}</p>
        {(skill.createdAt || skill.updatedAt) && (
          <p className="text-xs text-muted-foreground">
            {skill.createdAt && <>作成日: {format(new Date(skill.createdAt), "yyyy-MM-dd")}</>}
            {skill.createdAt && skill.updatedAt && "　"}
            {skill.updatedAt && <>更新日: {format(new Date(skill.updatedAt), "yyyy-MM-dd")}</>}
          </p>
        )}
        <div className="flex items-center justify-end gap-1">
          {skill.enabled && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setArchiveDialogOpen(true)}
            >
              <Archive className="size-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(skill)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:text-destructive"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={busy}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </CardContent>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="スキルを削除しますか？"
        description={
          <>
            「{skill.title || skill.name}」を削除します。削除したスキルは Claude Code から呼び出せなくなりますが、
            完全には消えず、スキル管理の「削除済みスキル」から元に戻せます。
          </>
        }
        confirmLabel="削除する"
        confirming={busy}
        onConfirm={handleDelete}
      />

      <SkillArchiveDialog
        open={archiveDialogOpen}
        onOpenChange={setArchiveDialogOpen}
        projectId={projectId}
        skill={skill}
        onArchive={onArchive}
        onRestore={onRestore}
      />
    </Card>
  )
}
