"use client"

import { useState } from "react"
import { Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
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
      toast.success("ルールを削除しました")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={cn(!rule.enabled && "opacity-60")}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="text-xs font-mono text-muted-foreground">{rule.id}</div>
        <Tooltip>
          <TooltipTrigger render={<div />}>
            <Switch checked={rule.enabled} disabled={busy} onCheckedChange={handleToggle} />
          </TooltipTrigger>
          <TooltipContent>{rule.enabled ? "有効（CLAUDE.mdに反映中）" : "無効"}</TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed">{rule.content}</p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>最終更新: {rule.updated_at}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(rule)}>
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-destructive hover:text-destructive"
              onClick={handleDelete}
              disabled={busy}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
