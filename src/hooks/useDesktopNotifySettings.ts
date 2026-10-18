"use client"

import useSWR from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"

interface Settings {
  notifications: boolean
}

/** 要対応のデスクトップ通知のオン・オフ(サーバー側に保存。初期値はオフ) */
export function useDesktopNotifySettings() {
  const { data, error, isLoading, mutate } = useSWR<Settings>("/api/desktop-sessions/settings", fetcher)

  async function setEnabled(next: boolean) {
    const saved = await apiMutate<Settings>("/api/desktop-sessions/settings", "POST", { notifications: next })
    await mutate(saved, { revalidate: false })
  }

  return { enabled: data?.notifications === true, isLoading, error, setEnabled }
}
