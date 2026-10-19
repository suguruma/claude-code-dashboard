"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { OrgMemoryBodyResponse, OrgRulesResponse } from "@/lib/orgRulesTypes"

/**
 * 組織のルール(⑨)。ルールは頻繁に変わらないので、開いたときに1回読むだけにする(自動の再取得はしない)。
 * 読み直すときは reload を呼ぶ
 */
export function useOrgRules() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<OrgRulesResponse>("/api/org-rules", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    keepPreviousData: true,
  })
  return { data: data ?? null, error, isLoading, isValidating, reload: () => mutate() }
}

/** 記憶の本文。行を開いたとき(enabled が true になったとき)だけ取りに行く */
export function useOrgMemoryBody(folderKey: string, fileName: string, enabled: boolean) {
  const key = enabled ? `/api/org-rules/memory?folder=${encodeURIComponent(folderKey)}&file=${encodeURIComponent(fileName)}` : null
  const { data, error, isLoading } = useSWR<OrgMemoryBodyResponse>(key, fetcher, { revalidateOnFocus: false })
  return { data: data ?? null, error, isLoading }
}
