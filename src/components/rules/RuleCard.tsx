"use client"

import { useState } from "react"
import { GripVertical, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Rule } from "@/lib/types"
import { cn } from "@/lib/utils"

interface RuleCardProps {
  rule: Rule
  onToggle: (id: string, enabled: boolean) => Promise<void>
  onEdit: (rule: Rule) => void
  onDelete: (id: string) => Promise<void>
}

export function RuleCard({ rule, onToggle, onEdit, onDelete }: RuleCardProps) {
  const [busy, setBusy] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  async function handleToggle(checked: boolean) {
    setBusy(true)
    try {
      await onToggle(rule.id, checked)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新に失敗しました")
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    try {
      await onDelete(rule.id)
      toast.success("ルールを削除しました（「設定 & システム情報」のバックアップから戻せます）")
      setDeleteConfirmOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(!rule.enabled && "opacity-60", isDragging && "z-10 opacity-50 shadow-lg")}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <button
            type="button"
            className="mt-0.5 shrink-0 cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
            aria-label="ドラッグして並び替え"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <div className="text-sm font-medium">{rule.category}</div>
        </div>
        <Tooltip>
          <TooltipTrigger render={<div />}>
            <Switch checked={rule.enabled} disabled={busy} onCheckedChange={handleToggle} />
          </TooltipTrigger>
          <TooltipContent>{rule.enabled ? "有効（CLAUDE.mdに反映中）" : "無効"}</TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{rule.content}</p>
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(rule)}>
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
        title="ルールを削除しますか？"
        description={
          <>
            「{rule.category}」を CLAUDE.md から削除します。削除前の CLAUDE.md は自動でバックアップされ、
            「設定 & システム情報」の「バックアップ」から元に戻せます。
          </>
        }
        confirmLabel="削除する"
        confirming={busy}
        onConfirm={handleDelete}
      />
    </Card>
  )
}
