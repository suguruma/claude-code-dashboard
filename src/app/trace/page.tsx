"use client"

import { useState } from "react"
import { useProjects } from "@/hooks/useProjects"
import { useExecutionLogs } from "@/hooks/useExecutionLogs"
import { usePersistedState } from "@/hooks/useLocalStorage"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { AnalysisProjectSelector } from "@/components/analysis/AnalysisProjectSelector"
import { LogList } from "@/components/trace/LogList"
import { ConsensusMeter } from "@/components/trace/ConsensusMeter"
import { TradeOffCompare } from "@/components/trace/TradeOffCompare"
import { InterventionCard } from "@/components/trace/InterventionCard"
import { NextPromptPanel } from "@/components/trace/NextPromptPanel"
import { AgentOrgChart } from "@/components/trace/AgentOrgChart"
import { TrialProcessTimeline } from "@/components/trace/TrialProcessTimeline"

export default function TracePage() {
  const { projects, selectedProjectId, selectedProject, isLoading: projectsLoading } = useProjects()
  const [manuallySelectedProjectId, setManuallySelectedProjectId] = usePersistedState<string | null>(
    "ccd:trace-analysis-project",
    null
  )
  const analysisProjectId = manuallySelectedProjectId ?? projects[0]?.id ?? null
  const analysisProject = projects.find((p) => p.id === analysisProjectId) ?? null

  const { logs, skipped, isLoading, error, saveSuggestedRules, deleteLog, mutate } =
    useExecutionLogs(analysisProjectId)
  const [manuallySelectedTaskId, setManuallySelectedTaskId] = useState<string | null>(null)
  const selectedTaskId = manuallySelectedTaskId ?? logs[0]?.task_id ?? null
  // 提案ルールを保存したログ（分析対象・保存先・タスクの組）。別のログを選んで戻ってきても「保存済み」のまま、二重に保存させない
  const [savedKeys, setSavedKeys] = useState<ReadonlySet<string>>(new Set())
  const savedKeyOf = (taskId: string) => `${analysisProjectId}|${selectedProjectId}|${taskId}`

  async function handleSaveSuggestedRules(taskId: string) {
    // 保存先は「分析対象」ではなく、設定管理（TopBar）で選択中のプロジェクトのCLAUDE.md
    if (!selectedProjectId) throw new Error("保存先のプロジェクトが選択されていません")
    const count = await saveSuggestedRules(taskId, selectedProjectId)
    setSavedKeys((prev) => new Set(prev).add(savedKeyOf(taskId)))
    await mutate()
    return count
  }

  async function handleDeleteLog(taskId: string) {
    await deleteLog(taskId)
    if (manuallySelectedTaskId === taskId) setManuallySelectedTaskId(null)
  }

  if (projectsLoading) {
    return <p className="text-sm text-muted-foreground">読み込み中...</p>
  }

  if (projects.length === 0) {
    return (
      <Alert>
        <AlertTitle>プロジェクトが未登録です</AlertTitle>
        <AlertDescription>
          画面右上の「+」からプロジェクトを登録してください。
        </AlertDescription>
      </Alert>
    )
  }

  const selectedEntry = logs.find((l) => l.task_id === selectedTaskId) ?? null
  // 手書き・他のツールが書いたログには、無いことがある
  const discussion = selectedEntry?.agents_discussion

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">実行ログ & 思考プロセス可視化</h1>
        <p className="text-sm text-muted-foreground">
          execution_log.jsonは、スキル（autonomous-production-team／session-log-extractor）を実際に実行した
          作業ディレクトリに書き出されるため、TopBar右上の「選択中プロジェクト」（設定管理の対象）とは独立して、
          下のセレクターで見たいプロジェクトを選んでください。
        </p>
      </div>

      <AnalysisProjectSelector
        projects={projects}
        value={analysisProjectId}
        onChange={setManuallySelectedProjectId}
      />

      {error && (
        <Alert variant="destructive">
          <AlertTitle>読み込みエラー</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {skipped > 0 && (
        <Alert>
          <AlertTitle>表示できないエントリがあります（{skipped}件）</AlertTitle>
          <AlertDescription>
            execution_log.json に、task_id が無い（または文字列・数値でない）エントリがあります。画面には出せませんが、ファイルには残っています。
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && logs.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          {analysisProject?.name ?? "選択中のプロジェクト"}
          にはまだ実行ログがありません。Claude Code がタスクを完了すると execution_log.json
          に記録されます。
        </p>
      )}

      {logs.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
          <LogList
            logs={logs}
            selectedTaskId={selectedTaskId}
            onSelect={setManuallySelectedTaskId}
            onDelete={handleDeleteLog}
          />

          {selectedEntry && (
            <div className="min-w-0 space-y-6">
              <div>
                <h2 className="text-lg font-semibold">{selectedEntry.task_name}</h2>
                <p className="text-sm text-muted-foreground mt-1">{selectedEntry.summary}</p>
                {selectedEntry.skill_names && selectedEntry.skill_names.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedEntry.skill_names.map((name) => (
                      <Badge key={name} variant="outline" className="font-mono text-xs font-normal">
                        {name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {discussion ? (
                <>
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">エージェント構成</h3>
                    <AgentOrgChart
                      agents={discussion.assigned_agents ?? []}
                      chainOfCommand={discussion.chain_of_command}
                    />
                  </div>

                  {typeof discussion.consensus_rate === "number" && (
                    <>
                      <Separator />
                      <ConsensusMeter label="エージェント間 全体合意度" value={discussion.consensus_rate} />
                    </>
                  )}

                  {(discussion.conflict_point !== undefined || (discussion.trade_offs?.length ?? 0) > 0) && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <h3 className="text-sm font-medium">対立点とトレードオフ</h3>
                        <TradeOffCompare
                          conflictPoint={discussion.conflict_point ?? ""}
                          tradeOffs={discussion.trade_offs ?? []}
                        />
                      </div>
                    </>
                  )}

                  {(discussion.trial_process?.length ?? 0) > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <h3 className="text-sm font-medium">試行錯誤・リトライの過程</h3>
                        <TrialProcessTimeline steps={discussion.trial_process ?? []} />
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">このログには、エージェント間の議論の記録がありません。</p>
              )}

              {selectedEntry.user_interventions.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">ユーザー介入・手戻りポイント</h3>
                  <div className="space-y-2">
                    {selectedEntry.user_interventions.map((iv, idx) => (
                      <InterventionCard key={idx} intervention={iv} />
                    ))}
                  </div>
                </div>
              )}

              <NextPromptPanel
                key={selectedEntry.task_id}
                entry={selectedEntry}
                saved={savedKeys.has(savedKeyOf(selectedEntry.task_id))}
                onSave={handleSaveSuggestedRules}
                targetProjectName={selectedProject?.name}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
