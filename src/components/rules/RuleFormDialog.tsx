"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Rule } from "@/lib/types"

interface RuleFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialRule?: Rule | null
  onSubmit: (input: { category: string; content: string }) => Promise<void>
}

export function RuleFormDialog({
  open,
  onOpenChange,
  initialRule,
  onSubmit,
}: RuleFormDialogProps) {
  const [category, setCategory] = useState(initialRule?.category ?? "")
  const [content, setContent] = useState(initialRule?.content ?? "")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!category.trim() || !content.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({ category: category.trim(), content: content.trim() })
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initialRule ? "ルールを編集" : "ルールを追加"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="rule-category">見出し（CLAUDE.mdの `## `）</Label>
            <Input
              id="rule-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="例: 出力形式 / コード品質 / 自律実行"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rule-content">ルール内容</Label>
            <Textarea
              id="rule-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="例: 結論は必ず冒頭に配置する"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {initialRule ? "更新する" : "追加する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
