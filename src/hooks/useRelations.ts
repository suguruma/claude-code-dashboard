"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { RelationsResponse } from "@/lib/relationsTypes"

/** 関係性マップ(⑬ 組織の「つながり」)。開いたときに読み、見ている間は1分ごとに読み直す(報告待ちの分を進めるため) */
export function useRelations() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<RelationsResponse>("/api/relations", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  return { data: data ?? null, error, isLoading, isValidating, reload: () => mutate() }
}
