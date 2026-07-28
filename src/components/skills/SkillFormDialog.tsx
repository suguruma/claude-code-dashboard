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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SkillMeta } from "@/lib/types"
import { SKILL_CATEGORIES, getCategoryMeta } from "@/lib/skillCategories"

interface SkillFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSkill?: SkillMeta | null
  onSubmit: (input: {
    dirName: string
    description: string
    body: string
    category?: string
    title?: string
    targetModel?: string
  }) => Promise<void>
}

const UNCATEGORIZED_VALUE = "__uncategorized__"

export function SkillFormDialog({
  open,
  onOpenChange,
  initialSkill,
  onSubmit,
}: SkillFormDialogProps) {
  const [dirName, setDirName] = useState(initialSkill?.dirName ?? "")
  const [title, setTitle] = useState(initialSkill?.title ?? "")
  const [description, setDescription] = useState(initialSkill?.description ?? "")
  const [body, setBody] = useState(initialSkill?.body ?? "")
  const [category, setCategory] = useState(initialSkill?.category ?? UNCATEGORIZED_VALUE)
  const [targetModel, setTargetModel] = useState(initialSkill?.targetModel ?? "")
  const [submitting, setSubmitting] = useState(false)

  const isEditing = Boolean(initialSkill)

  async function handleSubmit() {
    if (!dirName.trim() || !description.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({
        dirName: dirName.trim(),
        description: description.trim(),
        body,
        // 未分類/未設定は空文字として送る（JSON化でキー自体が消えるundefinedだと、
        // 更新時に「変更なし」と区別できず既存の値が残ってしまうため）
        category: category === UNCATEGORIZED_VALUE ? "" : category,
        title: title.trim(),
        targetModel: targetModel.trim(),
      })
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
            <Label htmlFor="skill-title">表示名（見出し）</Label>
            <Input
              id="skill-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: コードレビュー支援（未設定時はディレクトリ名を表示）"
            />
            <p className="text-xs text-muted-foreground">
              一覧に見出しとして表示する人間向けの名前です。呼び出しコマンド（下のディレクトリ名）とは独立しており、いつでも変更できます。
            </p>
          </div>
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
            <Label htmlFor="skill-category">カテゴリ</Label>
            <Select value={category} onValueChange={(v) => v && setCategory(v)}>
              <SelectTrigger id="skill-category" className="w-full">
                <SelectValue placeholder="カテゴリを選択">
                  {(value: string) => {
                    const meta = getCategoryMeta(value === UNCATEGORIZED_VALUE ? undefined : value)
                    return `${meta.emoji} ${meta.label}`
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCATEGORIZED_VALUE}>未分類</SelectItem>
                {SKILL_CATEGORIES.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>
                    {c.emoji} {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="skill-target-model">対象モデル</Label>
            <Input
              id="skill-target-model"
              value={targetModel}
              onChange={(e) => setTargetModel(e.target.value)}
              placeholder="例: Opus 5（未設定可。モデルは今後も増えるため自由入力）"
            />
            <p className="text-xs text-muted-foreground">
              このスキルのプロンプト設計がどのモデルを想定しているかのメモです。Claude Codeの動作には影響しません。
            </p>
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
