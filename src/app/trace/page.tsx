"use client"

import { useState } from "react"
import { useProjects } from "@/hooks/useProjects"
import { useExecutionLogs } from "@/hooks/useExecutionLogs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { LogList } from "@/components/trace/LogList"
import { ConsensusMeter } from "@/components/trace/ConsensusMeter"
import { TradeOffCompare } from "@/components/trace/TradeOffCompare"
import { InterventionCard } from "@/components/trace/InterventionCard"
import { GoldenPromptPanel } from "@/components/trace/GoldenPromptPanel"
import { AgentOrgChart } from "@/components/trace/AgentOrgChart"
import { TrialProcessTimeline } from "@/components/trace/TrialProcessTimeline"

export default function TracePage() {
  const { selectedProjectId, selectedProject, isLoading: projectsLoading } = useProjects()
  const { logs, isLoading, error, saveGoldenPromptRules, mutate } =
    useExecutionLogs(selectedProjectId)
  const [manuallySelectedTaskId, setManuallySelectedTaskId] = useState<string | null>(null)
  const selectedTaskId = manuallySelectedTaskId ?? logs[0]?.task_id ?? null

  async function handleSaveGoldenPrompt(taskId: string) {
    const count = await saveGoldenPromptRules(taskId)
    await mutate()
    return count
  }

  if (projectsLoading) {
    return <p className="text-sm text-muted-foreground">読み込み中...</p>
  }

  if (!selectedProject) {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">実行ログ & 思考プロセス可視化</h1>
        <p className="text-sm text-muted-foreground">
          {selectedProject.name} の execution_log.json を可視化します
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>読み込みエラー</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {!isLoading && logs.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          まだ実行ログがありません。Claude Code がタスクを完了すると execution_log.json
          に記録されます。
        </p>
      )}

      {logs.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
          <LogList
            logs={logs}
            selectedTaskId={selectedTaskId}
            onSelect={setManuallySelectedTaskId}
          />

          {selectedEntry && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">{selectedEntry.task_name}</h2>
                <p className="text-sm text-muted-foreground mt-1">{selectedEntry.summary}</p>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">エージェント構成</h3>
                <AgentOrgChart agents={selectedEntry.agents_discussion.assigned_agents ?? []} />
              </div>

              <Separator />

              <ConsensusMeter
                label="エージェント間 全体合意度"
                value={selectedEntry.agents_discussion.consensus_rate}
              />

              <Separator />

              <div className="space-y-2">
                <h3 className="text-sm font-medium">対立点とトレードオフ</h3>
                <TradeOffCompare
                  conflictPoint={selectedEntry.agents_discussion.conflict_point}
                  tradeOffs={selectedEntry.agents_discussion.trade_offs}
                />
              </div>

              {(selectedEntry.agents_discussion.trial_process?.length ?? 0) > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">試行錯誤・リトライの過程</h3>
                    <TrialProcessTimeline steps={selectedEntry.agents_discussion.trial_process ?? []} />
                  </div>
                </>
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

              <GoldenPromptPanel entry={selectedEntry} onSave={handleSaveGoldenPrompt} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
