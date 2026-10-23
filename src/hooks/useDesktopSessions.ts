"use client"

import { useCallback } from "react"
import useSWR, { type SWRConfiguration } from "swr"
import { fetcher } from "@/lib/fetcher"
import { abortInflight, fetchLatest } from "@/lib/latestFetch"
import type { DesktopSessionDetail, DesktopSessionListResponse } from "@/lib/desktopSessionTypes"

const POLL_VISIBLE_MS = 5_000
/** 非表示のタブでは更新間隔を延ばし、常時監視の負荷を抑える */
const POLL_HIDDEN_MS = 30_000

const interval = () => (typeof document !== "undefined" && document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)

const LIST_KEY = "/api/desktop-sessions"

/**
 * options: 取り方を重ねる(スマホ用のページは、間隔を延ばし、隠れているあいだは止める。⑪-2)。
 * retry: ［もう一度読み込む］。待っている要求を止めてから出し直し、画面の側の要求を1本に保つ(⑫ ST-8)
 */
export function useDesktopSessions(enabled: boolean = true, options?: SWRConfiguration) {
  const { data, error, isLoading, mutate } = useSWR<DesktopSessionListResponse>(
    enabled ? LIST_KEY : null,
    (url: string) => fetchLatest<DesktopSessionListResponse>(LIST_KEY, url),
    {
      refreshInterval: interval,
      refreshWhenHidden: true,
      keepPreviousData: true,
      ...options,
    }
  )
  const retry = useCallback(() => {
    abortInflight(LIST_KEY)
    return mutate()
  }, [mutate])
  return { data: data ?? null, error, isLoading, retry }
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
