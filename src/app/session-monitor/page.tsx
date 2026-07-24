"use client"

import { useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useSessionMetrics, useSessionProjects, useSessions } from "@/hooks/useSessionMonitor"
import { SessionProjectSelector } from "@/components/sessionMonitor/SessionProjectSelector"
import { SessionList } from "@/components/sessionMonitor/SessionList"
import { SessionSummaryCards } from "@/components/sessionMonitor/SessionSummaryCards"
import { TokenUsageChart } from "@/components/sessionMonitor/TokenUsageChart"
import { ToolCallChart } from "@/components/sessionMonitor/ToolCallChart"
import { McpUsageChart } from "@/components/sessionMonitor/McpUsageChart"
import { ToolOutputSizeChart } from "@/components/sessionMonitor/ToolOutputSizeChart"
import { SkillSubagentUsage } from "@/components/sessionMonitor/SkillSubagentUsage"
import { CompactionTimeline } from "@/components/sessionMonitor/CompactionTimeline"

export default function SessionMonitorPage() {
  const { projects, isLoading: projectsLoading, error: projectsError } = useSessionProjects()
  const [manuallySelectedDir, setManuallySelectedDir] = useState<string | null>(null)
  const [manuallySelectedSession, setManuallySelectedSession] = useState<string | null>(null)
  const [live, setLive] = useState(false)

  const selectedDirName = manuallySelectedDir ?? projects[0]?.dirName ?? null
  const { sessions, isLoading: sessionsLoading } = useSessions(selectedDirName)
  const selectedSessionId = manuallySelectedSession ?? sessions[0]?.sessionId ?? null
  const { metrics } = useSessionMetrics(selectedDirName, selectedSessionId, live)

  function handleSelectDir(dirName: string) {
    setManuallySelectedDir(dirName)
    setManuallySelectedSession(null)
  }

  if (projectsLoading) {
    return <p className="text-sm text-muted-foreground">読み込み中...</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">セッション監視</h1>
        <p className="text-sm text-muted-foreground">
          このマシンの実際のClaude Code実行ログ（<code className="font-mono">~/.claude/projects/</code>
          配下の`.jsonl`）を解析し、トークン消費・ツール呼び出し・コンテキスト圧縮を可視化します（読み取り専用）。
          ダッシュボードに登録したプロジェクトとは独立して、実際にClaude Codeを実行した場所の一覧から選びます。
        </p>
      </div>

      {projectsError && (
        <Alert variant="destructive">
          <AlertTitle>読み込みエラー</AlertTitle>
          <AlertDescription>{projectsError.message}</AlertDescription>
        </Alert>
      )}

      {!projectsLoading && projects.length === 0 && !projectsError && (
        <Alert>
          <AlertTitle>セッションログが見つかりません</AlertTitle>
          <AlertDescription>
            このマシンの <code className="font-mono">~/.claude/projects/</code> にセッションログ
            （.jsonl）を持つディレクトリが見つかりませんでした。
          </AlertDescription>
        </Alert>
      )}

      {projects.length > 0 && (
        <SessionProjectSelector projects={projects} value={selectedDirName} onChange={handleSelectDir} />
      )}

      {selectedDirName && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">セッション一覧</CardTitle>
            </CardHeader>
            <CardContent>
              {sessionsLoading ? (
                <p className="text-sm text-muted-foreground">読み込み中...</p>
              ) : (
                <SessionList
                  sessions={sessions}
                  selectedSessionId={selectedSessionId}
                  onSelect={setManuallySelectedSession}
                />
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {metrics ? (
              <>
                <div className="flex items-center justify-end gap-2">
                  <Label htmlFor="live-toggle" className="text-sm text-muted-foreground">
                    自動更新（3秒間隔）
                  </Label>
                  <Switch id="live-toggle" checked={live} onCheckedChange={setLive} />
                </div>

                <SessionSummaryCards metrics={metrics} />

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">トークン消費の推移（ターンごと）</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TokenUsageChart tokenPoints={metrics.tokenPoints} compactions={metrics.compactions} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">ツール呼び出し集計</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ToolCallChart
                      countsByName={metrics.toolCallCountsByName}
                      errorCountsByName={metrics.toolErrorCountsByName}
                    />
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">MCPサーバー別 呼び出し集計</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <McpUsageChart countsByServer={metrics.mcpCallCountsByServer} />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">スキル・サブエージェント発火状況</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <SkillSubagentUsage
                        skillCallCounts={metrics.skillCallCounts}
                        subagentCallCounts={metrics.subagentCallCounts}
                      />
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">ツール出力サイズ（文字数）ランキング</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ToolOutputSizeChart charsByName={metrics.toolOutputCharsByName} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">コンパクション（コンテキスト圧縮）履歴</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CompactionTimeline compactions={metrics.compactions} />
                  </CardContent>
                </Card>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">セッションを選択してください。</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
