"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { ScheduledActivityResponse } from "@/lib/scheduledActivityTypes"

/**
 * 予定タスクのタブ(⑯)。開いているタブのときだけ読み(タブの中身はそのときだけ描かれる)、見ている間は1分ごとに読み直す。
 * 予定タスクの回は1日に数回なので、1分ごとで足りる
 */
export function useScheduledActivity() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<ScheduledActivityResponse>("/api/scheduled-activity", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  return { data: data ?? null, error, isLoading, isValidating, reload: () => mutate() }
}
