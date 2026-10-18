"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { HousekeepingResponse } from "@/lib/housekeepingTypes"

const POLL_VISIBLE_MS = 30_000
/** 非表示のタブでは更新間隔を延ばし、常時監視の負荷を抑える */
const POLL_HIDDEN_MS = 120_000

const interval = () => (typeof document !== "undefined" && document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)

/** セッションの整理(コンテキスト整理の候補・返事の無い指示・判断待ち) */
export function useHousekeeping() {
  const { data, error, isLoading } = useSWR<HousekeepingResponse>("/api/desktop-sessions/housekeeping", fetcher, {
    refreshInterval: interval,
    refreshWhenHidden: true,
    keepPreviousData: true,
  })
  return { data: data ?? null, error, isLoading }
}
