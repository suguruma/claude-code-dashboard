"use client"

import { useCallback } from "react"
import useSWR, { type SWRConfiguration } from "swr"
import { abortInflight, fetchLatest } from "@/lib/latestFetch"
import type { UsageResponse } from "@/lib/usageTypes"

const POLL_VISIBLE_MS = 30_000
/** 非表示のタブでは更新間隔を延ばし、常時監視の負荷を抑える */
const POLL_HIDDEN_MS = 120_000

const interval = () => (typeof document !== "undefined" && document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)

const USAGE_KEY = "/api/usage"
const OFFICIAL_KEY = "/api/usage?phase=official"

/**
 * 利用上限の公式値・推定・セッション別の消費。enabled=false のあいだは取得しない。options: 取り方を重ねる(スマホ用のページ)。
 * retry: ［もう一度読み込む］(⑫ ST-8)
 */
export function useUsage(enabled: boolean = true, options?: SWRConfiguration) {
  const { data, error, isLoading, mutate } = useSWR<UsageResponse>(
    enabled ? USAGE_KEY : null,
    (url: string) => fetchLatest<UsageResponse>(USAGE_KEY, url),
    {
      refreshInterval: interval,
      refreshWhenHidden: true,
      keepPreviousData: true,
      ...options,
    }
  )
  const retry = useCallback(() => {
    abortInflight(USAGE_KEY)
    return mutate()
  }, [mutate])
  return { data: data ?? null, error, isLoading, retry }
}

/**
 * 利用上限の公式値だけ(記録を読むだけの軽い答え。推定はまだ)。ホームが、推定より先に公式値を出すために1回だけ取る(⑫ ST-7・Q8)。
 * 推定を含む答え(useUsage)が来たら、そちらを使う
 */
export function useUsageOfficial(enabled: boolean) {
  const { data, error } = useSWR<UsageResponse>(
    enabled ? OFFICIAL_KEY : null,
    (url: string) => fetchLatest<UsageResponse>(OFFICIAL_KEY, url),
    { revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false, shouldRetryOnError: false }
  )
  return { data: data ?? null, error }
}
