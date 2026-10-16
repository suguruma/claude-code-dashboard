"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface SettingsEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  raw: Record<string, unknown>
  isGlobalConfig?: boolean
  onSave: (raw: Record<string, unknown>) => Promise<void>
}

export function SettingsEditDialog({
  open,
  onOpenChange,
  raw,
  isGlobalConfig,
  onSave,
}: SettingsEditDialogProps) {
  const [text, setText] = useState(() => JSON.stringify(raw, null, 2))
  const [parseError, setParseError] = useState<string | null>(null)
  const [pendingRaw, setPendingRaw] = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving] = useState(false)

  function handleOpenChange(next: boolean) {
    if (next) {
      setText(JSON.stringify(raw, null, 2))
      setParseError(null)
    }
    onOpenChange(next)
  }

  function handleReviewSave() {
    try {
      const parsed = JSON.parse(text)
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setParseError("JSONオブジェクト（{ ... }）で入力してください")
        return
      }
      setParseError(null)
      setPendingRaw(parsed)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "JSONの構文が不正です")
    }
  }

  async function handleConfirmSave() {
    if (!pendingRaw) return
    setSaving(true)
    try {
      await onSave(pendingRaw)
      toast.success("settings.json を保存しました")
      setPendingRaw(null)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>settings.json を編集</DialogTitle>
            <DialogDescription>
              JSONを直接編集して保存します。保存前に現在の内容を自動でバックアップします。
              {isGlobalConfig && (
                <span className="mt-1 block font-medium text-destructive">
                  実際の ~/.claude/settings.json に書き込まれます。
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setParseError(null)
            }}
            className="min-h-[360px] flex-1 resize-none font-mono text-xs"
            spellCheck={false}
          />
          {parseError && <p className="text-xs text-destructive">{parseError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button onClick={handleReviewSave}>保存する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRaw !== null}
        onOpenChange={(o) => !o && setPendingRaw(null)}
        title="settings.json を上書きしますか？"
        description={
          isGlobalConfig
            ? "実際の ~/.claude/settings.json が書き換わります。現在の内容は保存前に自動でバックアップされます。"
            : "現在の内容は保存前に自動でバックアップされます。"
        }
        confirmLabel="上書きする"
        confirming={saving}
        onConfirm={handleConfirmSave}
      />
    </>
  )
}
