"use client"

import { useState } from "react"
import { GripVertical, Plus } from "lucide-react"
import { toast } from "sonner"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable"
import { useProjects } from "@/hooks/useProjects"
import { useRules } from "@/hooks/useRules"
import { useExecutionLogs } from "@/hooks/useExecutionLogs"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { RuleCard } from "@/components/rules/RuleCard"
import { RuleFormDialog } from "@/components/rules/RuleFormDialog"
import { PromptSummaryCard } from "@/components/rules/PromptSummaryCard"
import { Rule } from "@/lib/types"

export default function RulesPage() {
  const { selectedProjectId, selectedProject, isLoading: projectsLoading } = useProjects()
  const { rules, isLoading, error, createRule, updateRule, deleteRule, reorderRules } =
    useRules(selectedProjectId)
  const { logs } = useExecutionLogs(selectedProjectId)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = rules.findIndex((r) => r.id === active.id)
    const newIndex = rules.findIndex((r) => r.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const newOrder = arrayMove(rules, oldIndex, newIndex).map((r) => r.id)
    try {
      await reorderRules(newOrder)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "並び替えに失敗しました")
    }
  }

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
  const [formKey, setFormKey] = useState(0)

  function openCreateDialog() {
    setEditingRule(null)
    setFormKey((k) => k + 1)
    setDialogOpen(true)
  }

  function openEditDialog(rule: Rule) {
    setEditingRule(rule)
    setFormKey((k) => k + 1)
    setDialogOpen(true)
  }

  async function handleSubmit(input: { category: string; content: string }) {
    try {
      if (editingRule) {
        await updateRule(editingRule.id, input)
        toast.success("ルールを更新しました")
      } else {
        await createRule(input)
        toast.success("ルールを追加しました")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存に失敗しました")
      throw err
    }
  }

  if (projectsLoading) {
    return <p className="text-sm text-muted-foreground">読み込み中...</p>
  }

  if (!selectedProject) {
    return (
      <Alert>
        <AlertTitle>プロジェクトが未登録です</AlertTitle>
        <AlertDescription>
          画面右上の「+」からルールを監視する Claude Code プロジェクトを登録してください。
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">ルール管理</h1>
            <p className="text-sm text-muted-foreground">
              {selectedProject.name} の CLAUDE.md（## 見出し単位）を管理します。カード左上の
              <GripVertical className="mx-0.5 inline size-3.5 align-text-bottom" />
              ハンドルをドラッグすると表示順（CLAUDE.mdの記載順）を入れ替えられます
            </p>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="size-4" />
            ルールを追加
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>読み込みエラー</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        {!isLoading && rules.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">
            まだルールが登録されていません。「ルールを追加」から作成してください。
          </p>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={rules.map((r) => r.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={(id, enabled) => updateRule(id, { enabled })}
                  onEdit={openEditDialog}
                  onDelete={deleteRule}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">次回用プロンプト集</h2>
          <p className="text-sm text-muted-foreground">
            過去タスクで生成された「次回用の最適化プロンプト」をSOPとして一覧化しています
          </p>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ実行ログがありません。</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {logs.map((entry) => (
              <PromptSummaryCard key={entry.task_id} entry={entry} />
            ))}
          </div>
        )}
      </section>

      <RuleFormDialog
        key={formKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialRule={editingRule}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
