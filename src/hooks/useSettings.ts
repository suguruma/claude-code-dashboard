"use client"

import useSWR from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import { SettingsView } from "@/lib/types"

export function useSettings(projectId: string | null) {
  const key = projectId ? `/api/settings?projectId=${encodeURIComponent(projectId)}` : null
  const { data, error, isLoading, mutate } = useSWR<SettingsView>(key, fetcher)

  async function updateSettings(raw: Record<string, unknown>) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate<SettingsView>(
      `/api/settings?projectId=${encodeURIComponent(projectId)}`,
      "PATCH",
      { raw }
    )
    await mutate()
  }

  return { raw: data?.raw ?? {}, isLoading, error, updateSettings }
}
