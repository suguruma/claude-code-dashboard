"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { DesktopSessionDetail, DesktopSessionListResponse } from "@/lib/desktopSessionTypes"

const POLL_VISIBLE_MS = 5_000
/** 非表示のタブでは更新間隔を延ばし、常時監視の負荷を抑える */
const POLL_HIDDEN_MS = 30_000

const interval = () => (typeof document !== "undefined" && document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)

export function useDesktopSessions(enabled: boolean = true) {
  const { data, error, isLoading } = useSWR<DesktopSessionListResponse>(enabled ? "/api/desktop-sessions" : null, fetcher, {
    refreshInterval: interval,
    refreshWhenHidden: true,
    keepPreviousData: true,
  })
  return { data: data ?? null, error, isLoading }
}

export function useDesktopSessionDetail(id: string | null) {
  const key = id ? `/api/desktop-sessions/${encodeURIComponent(id)}` : null
  const { data, error, isLoading } = useSWR<DesktopSessionDetail>(key, fetcher, {
    refreshInterval: interval,
    refreshWhenHidden: true,
  })
  return { detail: data ?? null, error, isLoading }
}
