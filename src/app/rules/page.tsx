"use client"

import { useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { useProjects } from "@/hooks/useProjects"
import { useRules } from "@/hooks/useRules"
import { useExecutionLogs } from "@/hooks/useExecutionLogs"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { RuleCard } from "@/components/rules/RuleCard"
import { RuleFormDialog } from "@/components/rules/RuleFormDialog"
import { SkillCard } from "@/components/rules/SkillCard"
import { Rule } from "@/lib/types"

export default function RulesPage() {
  const { selectedProjectId, selectedProject, isLoading: projectsLoading } = useProjects()
  const { rules, isLoading, error, createRule, updateRule, deleteRule } =
    useRules(selectedProjectId)
  const { logs } = useExecutionLogs(selectedProjectId)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
  const [formKey, setFormKey] = useState(0)

  const grouped = useMemo(() => {
    const map = new Map<string, Rule[]>()
    for (const rule of rules) {
      const list = map.get(rule.category) ?? []
      list.push(rule)
      map.set(rule.category, list)
    }
    return Array.from(map.entries())
  }, [rules])

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">ルール & スキル管理</h1>
            <p className="text-sm text-muted-foreground">
              {selectedProject.name} の rules.json / CLAUDE.md を管理します
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

        {grouped.map(([category, categoryRules]) => (
          <div key={category} className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">【{category}】</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categoryRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={(id, enabled) => updateRule(id, { enabled })}
                  onEdit={openEditDialog}
                  onDelete={deleteRule}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">獲得スキル</h2>
          <p className="text-sm text-muted-foreground">
            過去タスクで生成された「黄金プロンプト」をSOPとして一覧化しています
          </p>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ実行ログがありません。</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {logs.map((entry) => (
              <SkillCard key={entry.task_id} entry={entry} />
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
