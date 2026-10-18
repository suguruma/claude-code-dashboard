"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { UsageResponse } from "@/lib/usageTypes"

const POLL_VISIBLE_MS = 30_000
/** 非表示のタブでは更新間隔を延ばし、常時監視の負荷を抑える */
const POLL_HIDDEN_MS = 120_000

const interval = () => (typeof document !== "undefined" && document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)

/** 利用上限の公式値・推定・セッション別の消費。enabled=false のあいだは取得しない */
export function useUsage(enabled: boolean = true) {
  const { data, error, isLoading } = useSWR<UsageResponse>(enabled ? "/api/usage" : null, fetcher, {
    refreshInterval: interval,
    refreshWhenHidden: true,
    keepPreviousData: true,
  })
  return { data: data ?? null, error, isLoading }
}
