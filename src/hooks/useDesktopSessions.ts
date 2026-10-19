"use client"

import useSWR, { type SWRConfiguration } from "swr"
import { fetcher } from "@/lib/fetcher"
import type { DesktopSessionDetail, DesktopSessionListResponse } from "@/lib/desktopSessionTypes"

const POLL_VISIBLE_MS = 5_000
/** 非表示のタブでは更新間隔を延ばし、常時監視の負荷を抑える */
const POLL_HIDDEN_MS = 30_000

const interval = () => (typeof document !== "undefined" && document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)

/** options: 取り方を重ねる(スマホ用のページは、間隔を延ばし、隠れているあいだは止める。⑪-2) */
export function useDesktopSessions(enabled: boolean = true, options?: SWRConfiguration) {
  const { data, error, isLoading } = useSWR<DesktopSessionListResponse>(enabled ? "/api/desktop-sessions" : null, fetcher, {
    refreshInterval: interval,
    refreshWhenHidden: true,
    keepPreviousData: true,
    ...options,
  })
  return { data: data ?? null, error, isLoading }
}

export function useDesktopSessionDetail(id: string | null, options?: SWRConfiguration) {
  const key = id ? `/api/desktop-sessions/${encodeURIComponent(id)}` : null
  const { data, error, isLoading } = useSWR<DesktopSessionDetail>(key, fetcher, {
    refreshInterval: interval,
    refreshWhenHidden: true,
    ...options,
  })
  return { detail: data ?? null, error, isLoading }
}
