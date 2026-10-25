"use client"

import useSWR from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import type { PageVisitsData } from "@/lib/pageVisits"

const KEY = "/api/page-visits"

/** ページを開いた回数と、数えるかどうか(⑬ FS-7。サーバー側に保存。初期値はオン) */
export function usePageVisits() {
  const { data, error, isLoading, mutate } = useSWR<PageVisitsData>(KEY, fetcher, { revalidateOnFocus: false })

  async function setEnabled(next: boolean) {
    const saved = await apiMutate<PageVisitsData>(KEY, "PUT", { enabled: next })
    await mutate(saved, { revalidate: false })
  }

  return {
    // 読めるまでは数えない(オフにした人の画面から、読み込みの前に送らないため)
    enabled: data?.enabled === true,
    visits: data?.visits ?? {},
    loaded: data !== undefined,
    isLoading,
    error,
    setEnabled,
    refresh: () => mutate(),
  }
}
