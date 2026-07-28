"use client"

import { useState } from "react"
import { Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SkillMeta } from "@/lib/types"

interface SkillListCardProps {
  skill: SkillMeta
  onEdit: (skill: SkillMeta) => void
  onDelete: (dirName: string) => Promise<void>
}

export function SkillListCard({ skill, onEdit, onDelete }: SkillListCardProps) {
  const [busy, setBusy] = useState(false)

  async function handleDelete() {
    if (!confirm(`スキル "${skill.name}" を削除しますか？`)) return
    setBusy(true)
    try {
      await onDelete(skill.dirName)
      toast.success("スキルを削除しました")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-sm">{skill.title || skill.dirName}</CardTitle>
          {skill.title && (
            <p className="truncate font-mono text-xs text-muted-foreground">{skill.dirName}</p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {skill.targetModel && <Badge variant="outline">🎯 {skill.targetModel}</Badge>}
          {skill.argumentSchema !== undefined && <Badge variant="outline">引数あり</Badge>}
          {skill.hasReferences && <Badge variant="secondary">📎 references</Badge>}
          {skill.hasScripts && <Badge variant="secondary">🔧 scripts</Badge>}
          {skill.hasEvals && <Badge variant="secondary">✅ evals</Badge>}
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
          <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(skill)}>
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
      </CardContent>
    </Card>
  )
}
