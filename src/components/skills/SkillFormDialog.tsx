"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SkillMeta } from "@/lib/types"

interface SkillFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSkill?: SkillMeta | null
  onSubmit: (input: { dirName: string; description: string; body: string }) => Promise<void>
}

export function SkillFormDialog({
  open,
  onOpenChange,
  initialSkill,
  onSubmit,
}: SkillFormDialogProps) {
  const [dirName, setDirName] = useState(initialSkill?.dirName ?? "")
  const [description, setDescription] = useState(initialSkill?.description ?? "")
  const [body, setBody] = useState(initialSkill?.body ?? "")
  const [submitting, setSubmitting] = useState(false)

  const isEditing = Boolean(initialSkill)

  async function handleSubmit() {
    if (!dirName.trim() || !description.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({ dirName: dirName.trim(), description: description.trim(), body })
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "スキルを編集" : "スキルを追加"}</DialogTitle>
          <DialogDescription>
            `.claude/skills/&lt;スキル名&gt;/SKILL.md` を{isEditing ? "更新" : "新規作成"}します。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 overflow-y-auto py-2">
          <div className="grid gap-2">
            <Label htmlFor="skill-dirname">スキル名（ディレクトリ名）</Label>
            <Input
              id="skill-dirname"
              value={dirName}
              onChange={(e) => setDirName(e.target.value)}
              placeholder="例: my-skill（半角英数字・ハイフン・アンダースコアのみ）"
            />
            {isEditing && dirName.trim() !== initialSkill?.dirName && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                変更するとフォルダ名も変わり、呼び出しコマンドが /{initialSkill?.dirName} から /
                {dirName.trim() || "..."} に変わります
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="skill-description">説明（description）</Label>
            <Textarea
              id="skill-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="このスキルが何をするか、いつ使うべきかを記述"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="skill-body">本文（Markdown）</Label>
            <Textarea
              id="skill-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={18}
              className="font-mono text-xs"
              placeholder="# スキルの手順など"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {isEditing ? "更新する" : "追加する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
