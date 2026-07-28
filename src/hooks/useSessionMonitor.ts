"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import {
  SessionDiagnosisMetrics,
  SessionMetrics,
  SessionProjectSummary,
  SessionSemanticDiagnosis,
  SessionSummary,
} from "@/lib/types"

export function useSessionProjects() {
  const { data, error, isLoading } = useSWR<{ projects: SessionProjectSummary[] }>(
    "/api/session-monitor/projects",
    fetcher
  )
  return { projects: data?.projects ?? [], isLoading, error }
}

export function useSessions(dirName: string | null) {
  const key = dirName ? `/api/session-monitor/projects/${encodeURIComponent(dirName)}/sessions` : null
  const { data, error, isLoading } = useSWR<{ sessions: SessionSummary[] }>(key, fetcher)
  return { sessions: data?.sessions ?? [], isLoading, error }
}

/**
 * セッション選択時に毎回取得する軽量版（summary + mcpCallCountsByServerのみ、詳細APIの約0.3%サイズ）。
 * 診断パネル・推移グラフの表示に必要な最小限のデータで、liveがtrueの間は3秒間隔でポーリングする。
 */
export function useSessionDiagnosisMetrics(
  dirName: string | null,
  sessionId: string | null,
  live: boolean
) {
  const key =
    dirName && sessionId
      ? `/api/session-monitor/projects/${encodeURIComponent(dirName)}/sessions/${encodeURIComponent(sessionId)}`
      : null
  const { data, error, isLoading } = useSWR<{ metrics: SessionDiagnosisMetrics }>(key, fetcher, {
    refreshInterval: live ? 3000 : 0,
    // 監視対象のタブをバックグラウンドに置いたまま作業するのが主な使い方のため、
    // SWR既定のrefreshWhenHidden:falseだと最も見たい場面で更新が止まってしまう
    refreshWhenHidden: live,
  })
  return { metrics: data?.metrics ?? null, isLoading, error }
}

/**
 * トークン推移・ツール別集計等を含む全メトリクス。ペイロードが大きい（同条件で数百KB〜）ため、
 * 「詳細データ」を開いたとき（enabled=true）だけ取得する。閉じるとSWRのキーがnullになり、
 * liveがtrueでもポーリングは自動的に止まる。
 */
export function useSessionDetailMetrics(
  dirName: string | null,
  sessionId: string | null,
  enabled: boolean,
  live: boolean
) {
  const key =
    enabled && dirName && sessionId
      ? `/api/session-monitor/projects/${encodeURIComponent(dirName)}/sessions/${encodeURIComponent(sessionId)}?detail=1`
      : null
  const { data, error, isLoading } = useSWR<{ metrics: SessionMetrics }>(key, fetcher, {
    refreshInterval: live ? 3000 : 0,
    refreshWhenHidden: live,
  })
  return { metrics: data?.metrics ?? null, isLoading, error }
}

/**
 * `session-diagnostician`スキル（Claude Code側）が生成した意味診断。ユーザーが手動で実行したときだけ
 * 更新されるため、liveのポーリング対象にはしない（診断パネルの表示時に一度取得すれば十分）。
 */
export function useSessionSemanticDiagnosis(dirName: string | null, sessionId: string | null) {
  const key =
    dirName && sessionId
      ? `/api/session-monitor/projects/${encodeURIComponent(dirName)}/sessions/${encodeURIComponent(sessionId)}/diagnosis`
      : null
  const { data, error, isLoading, mutate } = useSWR<{ diagnosis: SessionSemanticDiagnosis | null }>(
    key,
    fetcher
  )
  return { diagnosis: data?.diagnosis ?? null, isLoading, error, refresh: mutate }
}
