"use client"

import useSWR from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import type { IssuedPairing, LanOverview } from "@/lib/lanAccess/service"

/** スマホから見る(⑪)の状態。待ち受けの開始・端末の登録が数秒で反映されるよう、2秒ごとに読み直す */
export function useLanAccess() {
  const { data, error, isLoading, mutate } = useSWR<LanOverview>("/api/lan-access", fetcher, { refreshInterval: 2000 })

  async function setEnabled(enabled: boolean) {
    const next = await apiMutate<LanOverview>("/api/lan-access", "PUT", { enabled })
    await mutate(next, { revalidate: false })
  }

  async function issuePairing(): Promise<IssuedPairing> {
    const issued = await apiMutate<IssuedPairing>("/api/lan-access/pairing", "POST")
    await mutate()
    return issued
  }

  async function revoke(id: string) {
    await apiMutate(`/api/lan-access/devices/${encodeURIComponent(id)}`, "DELETE")
    await mutate()
  }

  async function rename(id: string, name: string) {
    await apiMutate(`/api/lan-access/devices/${encodeURIComponent(id)}`, "PATCH", { name })
    await mutate()
  }

  return { data, error, isLoading, setEnabled, issuePairing, revoke, rename }
}
