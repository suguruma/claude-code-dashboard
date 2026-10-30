"use client"

import { useMemo, useState } from "react"
import { ChevronRight } from "lucide-react"
import { SessionHealthPanel } from "@/components/sessionMonitor/SessionHealthPanel"
import { SessionSemanticDiagnosisPanel } from "@/components/sessionMonitor/SessionSemanticDiagnosisPanel"
import { useSessionDiagnosisMetrics, useSessionSemanticDiagnosis, useSessions } from "@/hooks/useSessionMonitor"
import { diagnoseHealth } from "@/lib/sessionDiagnostics"
import { cn } from "@/lib/utils"

/**
 * セッション一覧の詳細の「健康」(⑬ の棚卸しの行25・27。セッション監視のページから移した)。
 * 会話ログを解析する4つの観点の診断と、session-diagnostician スキルの AI 診断を出す。
 * 会話ログの解析は重いので、初めは閉じておき、開いたときだけ取りに行く。
 */
export function SessionHealthSection({ dirName, transcriptId }: { dirName: string; transcriptId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="space-y-2" aria-labelledby="session-health-title" data-testid="session-health">
      <h3 id="session-health-title" className="text-sm font-medium">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-11 items-center gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden />
          健康（会話ログの診断）
        </button>
      </h3>
      {!open && (
        <p className="text-sm text-muted-foreground">
          無限ループ（沼）の兆候・ワークフローの安定性・拡張機能（MCP）の稼働・セッションの寿命と、AI 診断（session-diagnostician スキルの結果）を、開いたときに読みます。
        </p>
      )}
      {open && <HealthBody dirName={dirName} transcriptId={transcriptId} />}
    </section>
  )
}

function HealthBody({ dirName, transcriptId }: { dirName: string; transcriptId: string }) {
  // 比べる相手(同じ作業フォルダの、ほかの会話ログ)。中央値との比較に使う
  const { sessions } = useSessions(dirName)
  const { metrics, isLoading, error } = useSessionDiagnosisMetrics(dirName, transcriptId, false)
  const { diagnosis, isLoading: semanticLoading, refresh } = useSessionSemanticDiagnosis(dirName, transcriptId)
  const report = useMemo(() => (metrics ? diagnoseHealth(metrics, sessions) : null), [metrics, sessions])

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">会話ログを読み込めませんでした。</p>}
      {isLoading && !report && <p className="text-sm text-muted-foreground">会話ログを解析しています...</p>}
      {report && <SessionHealthPanel report={report} title="4つの観点の診断" />}
      <SessionSemanticDiagnosisPanel diagnosis={diagnosis} isLoading={semanticLoading} onRefresh={refresh} />
    </div>
  )
}
