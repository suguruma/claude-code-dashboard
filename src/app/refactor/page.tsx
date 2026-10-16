"use client"

import { useState } from "react"
import { Wand2 } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { RuleRefactorList } from "@/components/refactor/RuleRefactorList"
import { AnalysisProjectSelector } from "@/components/analysis/AnalysisProjectSelector"
import { useProjects } from "@/hooks/useProjects"
import { useRuleRefactor } from "@/hooks/useRuleRefactor"
import { usePersistedState } from "@/hooks/useLocalStorage"

const INVOKE_COMMAND = "/rule-optimizer"

export default function RefactorPage() {
  const { projects, isLoading: projectsLoading } = useProjects()
  const [manuallySelectedProjectId, setManuallySelectedProjectId] = usePersistedState<string | null>(
    "ccd:refactor-analysis-project",
    null
  )
  const analysisProjectId = manuallySelectedProjectId ?? projects[0]?.id ?? null
  const analysisProject = projects.find((p) => p.id === analysisProjectId) ?? null

  const { generatedAt, items, isLoading, error, applyProposal, refresh } = useRuleRefactor(analysisProjectId)
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set())
  const [applying, setApplying] = useState(false)
  const [lastBackups, setLastBackups] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (projectsLoading) {
    return <p className="text-sm text-muted-foreground">読み込み中...</p>
  }

  if (projects.length === 0) {
    return (
      <Alert>
        <AlertTitle>プロジェクトが未登録です</AlertTitle>
        <AlertDescription>画面右上の「+」からプロジェクトを登録してください。</AlertDescription>
      </Alert>
    )
  }

  const readyIndexes = items.filter((i) => i.status === "ready").map((i) => i.index)

  function toggle(index: number) {
    setSelectedIndexes((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function selectAll() {
    setSelectedIndexes(new Set(readyIndexes))
  }

  function clearAll() {
    setSelectedIndexes(new Set())
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(INVOKE_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("クリップボードへのコピーに失敗しました")
    }
  }

  function handleApplyClick() {
    if (selectedIndexes.size === 0) {
      toast.error("適用する項目を選択してください")
      return
    }
    if (analysisProject?.isGlobalConfig) {
      setConfirmOpen(true)
      return
    }
    handleApply()
  }

  async function handleApply() {
    if (selectedIndexes.size === 0) {
      toast.error("適用する項目を選択してください")
      return
    }
    setConfirmOpen(false)
    setApplying(true)
    try {
      const result = await applyProposal([...selectedIndexes])
      toast.success(`${selectedIndexes.size}件を適用しました`)
      setLastBackups(result.backups)
      setSelectedIndexes(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "適用に失敗しました")
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">ルール矛盾・重複の整理</h1>
        <p className="text-sm text-muted-foreground">
          rule_refactor_proposal.jsonは、スキル（rule-optimizer）を実際に実行した作業ディレクトリに
          書き出されるため、TopBar右上の「選択中プロジェクト」（設定管理の対象）とは独立して、
          下のセレクターで見たいプロジェクトを選んでください。
        </p>
      </div>

      <AnalysisProjectSelector
        projects={projects}
        value={analysisProjectId}
        onChange={setManuallySelectedProjectId}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">1. rule-optimizerを実行する</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Claude Codeのターミナルで{analysisProject ? `${analysisProject.name}（上で選択中のプロジェクト）` : "対象プロジェクト"}
            を開き、以下のコマンドを実行してください。
            execution_log.jsonの過去のユーザー介入履歴から矛盾・重複ルールを検出し、統合案を
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">rule_refactor_proposal.json</code>
            として出力します（このダッシュボードは実行そのものは行いません）。
          </p>
          <div className="flex items-center gap-2">
            <code className="rounded-md bg-muted px-3 py-1.5 text-sm">{INVOKE_COMMAND}</code>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? "コピーしました" : "コピー"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">2. 提案内容を確認して適用する</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}
          {error && <p className="text-sm text-destructive">提案の取得に失敗しました</p>}

          {!isLoading && !error && generatedAt === null && (
            <Alert>
              <Wand2 className="size-4" />
              <AlertTitle>まだ提案がありません</AlertTitle>
              <AlertDescription>
                上記のコマンドを実行すると、ここに矛盾・重複ルールの整理案が表示されます。
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && !error && generatedAt !== null && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  生成日時：{new Date(generatedAt).toLocaleString("ja-JP")}
                </p>
                <Button variant="ghost" size="sm" onClick={() => refresh()}>
                  再読み込み
                </Button>
              </div>

              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">提案項目はありません。</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={selectAll}>
                      全て選択
                    </Button>
                    <Button variant="outline" size="sm" onClick={clearAll}>
                      全て解除
                    </Button>
                  </div>
                  <RuleRefactorList items={items} selectedIndexes={selectedIndexes} onToggle={toggle} />
                  <Button onClick={handleApplyClick} disabled={applying}>
                    {applying ? "適用中..." : `選択した${selectedIndexes.size}件を適用`}
                  </Button>
                </>
              )}
            </div>
          )}

          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="グローバル設定を上書きします"
            description={`適用先は${analysisProject?.name ?? "選択中のプロジェクト"}（実際の ~/.claude）です。選択した提案がClaude Code本体のCLAUDE.mdに直接反映されます。上書き前のCLAUDE.mdは自動でバックアップされますが、続行しますか？`}
            confirmLabel="上書きを実行する"
            onConfirm={handleApply}
            confirming={applying}
          />

          {lastBackups && (
            <Alert>
              <AlertTitle>適用が完了しました</AlertTitle>
              <AlertDescription>
                {lastBackups.length > 0 ? (
                  <>
                    上書き前のCLAUDE.mdは以下にバックアップされました：
                    <ul className="mt-1 list-inside list-disc font-mono text-xs">
                      {lastBackups.map((b) => (
                        <li key={b} className="truncate">
                          {b}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  "バックアップは作成されていません。"
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
