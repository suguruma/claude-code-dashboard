"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { MonitorAlertSummary, MonitorLoadResponse, MonitorPlanResponse, MonitorSnapshotResponse } from "@/lib/monitor/monitorTypes"

/** ［作業と待ち］(⑭)。開いているタブのときだけ読み、見ている間は1分ごとに読み直す(各セッションの追記は数分ごと) */
export function useMonitorPlan(enabled: boolean) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<MonitorPlanResponse>(enabled ? "/api/monitor/plan" : null, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  return { data: data ?? null, error, isLoading, isValidating, reload: () => mutate() }
}

/** ［負荷］の推移の図(⑭)。記録は約1分ごとなので、見ている間は1分ごとに読み直す(今日を見ているときだけ) */
export function useMonitorLoad(params: { date: string | null; range: number | null; center: number | null }, enabled: boolean, live: boolean) {
  const q = new URLSearchParams()
  if (params.date) q.set("date", params.date)
  if (params.range) q.set("range", String(params.range))
  if (params.center) q.set("center", String(Math.round(params.center / 60_000) * 60_000))
  const { data, error, isLoading, isValidating, mutate } = useSWR<MonitorLoadResponse>(enabled ? `/api/monitor/load?${q}` : null, fetcher, {
    refreshInterval: live ? 60_000 : 0,
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  return { data: data ?? null, error, isLoading, isValidating, reload: () => mutate() }
}

/** 選んだ時刻に動いていたもの。時刻を変えるたびに読む(同じ時刻は SWR の控えを使う) */
export function useMonitorSnapshot(at: number | null) {
  const { data, error, isLoading } = useSWR<MonitorSnapshotResponse>(at ? `/api/monitor/snapshot?at=${at}` : null, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  return { data: data ?? null, error, isLoading }
}

/** PC の警告の要約(ホームの帯・サイドバーの「！」・通知が同じ要求を共有する)。1分ごと */
export function useMonitorAlerts(enabled = true) {
  const { data } = useSWR<MonitorAlertSummary>(enabled ? "/api/monitor/alerts" : null, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  return data ?? null
}
