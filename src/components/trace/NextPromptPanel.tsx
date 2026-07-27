"use client"

import { useState } from "react"
import { Check, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ExecutionLogEntry } from "@/lib/types"

interface NextPromptPanelProps {
  entry: ExecutionLogEntry
  onSave: (taskId: string) => Promise<number>
  /** ルールの保存先プロジェクト名（分析対象とは別の、設定管理で選択中のプロジェクト） */
  targetProjectName?: string | null
}

export function NextPromptPanel({ entry, onSave, targetProjectName }: NextPromptPanelProps) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const count = await onSave(entry.task_id)
      setSaved(true)
      toast.success(`新規ルールを${count}件 CLAUDE.md に保存しました`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-primary" />
        次回用プロンプト
      </div>
      <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed font-mono">
        {entry.next_golden_prompt}
      </pre>

      {entry.suggested_new_rules.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">このプロンプトから抽出された新規ルール:</p>
          <div className="space-y-1.5">
            {entry.suggested_new_rules.map((r, idx) => (
              <div key={idx} className="flex items-start gap-1.5 rounded-md border bg-muted/40 p-2 text-xs">
                <Badge variant="outline" className="shrink-0">
                  {r.category}
                </Badge>
                <p className="leading-relaxed break-words">{r.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || saved || entry.suggested_new_rules.length === 0}
        >
          {saved ? <Check className="size-4" /> : null}
          {saved ? "保存済み" : "このルールを保存"}
        </Button>
        {targetProjectName && (
          <span className="text-xs text-muted-foreground">保存先: {targetProjectName}</span>
        )}
      </div>
    </div>
  )
}
