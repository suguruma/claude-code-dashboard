"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { MonitorPlanResponse } from "@/lib/monitor/monitorTypes"

/** ［作業と待ち］(⑭)。開いているタブのときだけ読み、見ている間は1分ごとに読み直す(各セッションの追記は数分ごと) */
export function useMonitorPlan(enabled: boolean) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<MonitorPlanResponse>(enabled ? "/api/monitor/plan" : null, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  return { data: data ?? null, error, isLoading, isValidating, reload: () => mutate() }
}
