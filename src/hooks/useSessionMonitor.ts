"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import { SessionMetrics, SessionProjectSummary, SessionSummary } from "@/lib/types"

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

/** liveがtrueの間、3秒間隔でセッションログの再解析結果をポーリングする（準リアルタイム更新） */
export function useSessionMetrics(dirName: string | null, sessionId: string | null, live: boolean) {
  const key =
    dirName && sessionId
      ? `/api/session-monitor/projects/${encodeURIComponent(dirName)}/sessions/${encodeURIComponent(sessionId)}`
      : null
  const { data, error, isLoading } = useSWR<{ metrics: SessionMetrics }>(key, fetcher, {
    refreshInterval: live ? 3000 : 0,
    // 監視対象のタブをバックグラウンドに置いたまま作業するのが主な使い方のため、
    // SWR既定のrefreshWhenHidden:falseだと最も見たい場面で更新が止まってしまう
    refreshWhenHidden: live,
  })
  return { metrics: data?.metrics ?? null, isLoading, error }
}
