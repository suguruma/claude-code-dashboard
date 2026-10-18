"use client"

import { Suspense, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { buildSessionTrends, diagnoseSession } from "@/lib/sessionDiagnostics"
import {
  useSessionDetailMetrics,
  useSessionDiagnosisMetrics,
  useSessionProjects,
  useSessionSemanticDiagnosis,
  useSessions,
} from "@/hooks/useSessionMonitor"
import { SessionProjectSelector } from "@/components/sessionMonitor/SessionProjectSelector"
import { SessionList } from "@/components/sessionMonitor/SessionList"
import { SessionHealthPanel } from "@/components/sessionMonitor/SessionHealthPanel"
import { SessionSemanticDiagnosisPanel } from "@/components/sessionMonitor/SessionSemanticDiagnosisPanel"
import { SessionTrendCharts } from "@/components/sessionMonitor/SessionTrendCharts"
import { SessionSummaryCards } from "@/components/sessionMonitor/SessionSummaryCards"
import { TokenUsageChart } from "@/components/sessionMonitor/TokenUsageChart"
import { ToolCallChart } from "@/components/sessionMonitor/ToolCallChart"
import { McpUsageChart } from "@/components/sessionMonitor/McpUsageChart"
import { ToolOutputSizeChart } from "@/components/sessionMonitor/ToolOutputSizeChart"
import { SkillSubagentUsage } from "@/components/sessionMonitor/SkillSubagentUsage"
import { CompactionTimeline } from "@/components/sessionMonitor/CompactionTimeline"

export default function SessionMonitorPage() {
  // useSearchParams を使うため、静的生成時のためにSuspenseで包む
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">読み込み中...</p>}>
      <SessionMonitorContent />
    </Suspense>
  )
}

function SessionMonitorContent() {
  const { projects, isLoading: projectsLoading, error: projectsError } = useSessionProjects()
  // Desktopセッション画面からの遷移(?dir=...&session=...)で、対象のセッションを最初から選択する
  const searchParams = useSearchParams()
  const [manuallySelectedDir, setManuallySelectedDir] = useState<string | null>(searchParams.get("dir"))
  const [manuallySelectedSession, setManuallySelectedSession] = useState<string | null>(searchParams.get("session"))
  const [live, setLive] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)

  const selectedDirName = manuallySelectedDir ?? projects[0]?.dirName ?? null
  const { sessions, isLoading: sessionsLoading } = useSessions(selectedDirName)
  const selectedSessionId = manuallySelectedSession ?? sessions[0]?.sessionId ?? null
  const { metrics } = useSessionDiagnosisMetrics(selectedDirName, selectedSessionId, live)
  const { metrics: detailMetrics, isLoading: detailLoading } = useSessionDetailMetrics(
    selectedDirName,
    selectedSessionId,
    detailOpen,
    live
  )
  const {
    diagnosis: semanticDiagnosis,
    isLoading: semanticLoading,
    refresh: refreshSemanticDiagnosis,
  } = useSessionSemanticDiagnosis(selectedDirName, selectedSessionId)

  // 判定・比較はいずれもCPUのみの純粋関数。再解析(live)のたびに走るためメモ化する
  const report = useMemo(() => (metrics ? diagnoseSession(metrics, sessions) : null), [metrics, sessions])
  const trends = useMemo(
    () => buildSessionTrends(sessions, selectedSessionId),
    [sessions, selectedSessionId]
  )

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
          配下の`.jsonl`）を解析し、「このセッションが健全か」「次に何をすべきか」を判定します（読み取り専用）。
          判定は同じプロジェクトの過去セッションとの比較を伴うため、作業を重ねるほど精度が上がります。
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
          <Card className="h-fit">
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

          <div className="min-w-0 space-y-4">
            {metrics && report ? (
              <>
                <div className="flex items-center justify-end gap-2">
                  <Label htmlFor="live-toggle" className="text-sm text-muted-foreground">
                    自動更新（3秒間隔）
                  </Label>
                  <Switch id="live-toggle" checked={live} onCheckedChange={setLive} />
                </div>

                <SessionHealthPanel report={report} />

                <SessionSemanticDiagnosisPanel
                  diagnosis={semanticDiagnosis}
                  isLoading={semanticLoading}
                  onRefresh={() => refreshSemanticDiagnosis()}
                />

                <SessionTrendCharts trends={trends} />

                <Card>
                  <CardHeader className="pb-0">
                    <button
                      type="button"
                      onClick={() => setDetailOpen((v) => !v)}
                      aria-expanded={detailOpen}
                      className="flex w-full items-center gap-1.5 text-left"
                    >
                      <ChevronRight
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          detailOpen && "rotate-90"
                        )}
                        aria-hidden
                      />
                      <CardTitle className="text-sm">詳細データ（生の集計値とグラフ）</CardTitle>
                    </button>
                  </CardHeader>
                  {detailOpen &&
                    (detailMetrics ? (
                      <CardContent className="space-y-4 pt-4">
                        <SessionSummaryCards metrics={detailMetrics} />

                        <div className="space-y-1">
                          <h3 className="text-sm font-medium">トークン消費の推移（ターンごと）</h3>
                          <TokenUsageChart
                            tokenPoints={detailMetrics.tokenPoints}
                            compactions={detailMetrics.compactions}
                          />
                        </div>

                        <div className="space-y-1">
                          <h3 className="text-sm font-medium">ツール呼び出し集計</h3>
                          <ToolCallChart
                            countsByName={detailMetrics.toolCallCountsByName}
                            errorCountsByName={detailMetrics.toolErrorCountsByName}
                          />
                        </div>

                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                          <div className="min-w-0 space-y-1">
                            <h3 className="text-sm font-medium">MCPサーバー別 呼び出し集計</h3>
                            <McpUsageChart countsByServer={detailMetrics.mcpCallCountsByServer} />
                          </div>
                          <div className="min-w-0 space-y-1">
                            <h3 className="text-sm font-medium">スキル・サブエージェント発火状況</h3>
                            <SkillSubagentUsage
                              skillCallCounts={detailMetrics.skillCallCounts}
                              subagentCallCounts={detailMetrics.subagentCallCounts}
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <h3 className="text-sm font-medium">ツール出力サイズ（文字数）ランキング</h3>
                          <ToolOutputSizeChart charsByName={detailMetrics.toolOutputCharsByName} />
                        </div>

                        <div className="space-y-1">
                          <h3 className="text-sm font-medium">コンパクション（コンテキスト圧縮）履歴</h3>
                          <CompactionTimeline compactions={detailMetrics.compactions} />
                        </div>
                      </CardContent>
                    ) : (
                      <CardContent className="pt-4">
                        <p className="text-sm text-muted-foreground">
                          {detailLoading ? "読み込み中..." : "詳細データを取得できませんでした。"}
                        </p>
                      </CardContent>
                    ))}
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
