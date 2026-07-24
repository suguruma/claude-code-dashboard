"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import { SettingsView } from "@/lib/types"

export function useSettings(projectId: string | null) {
  const key = projectId ? `/api/settings?projectId=${encodeURIComponent(projectId)}` : null
  const { data, error, isLoading } = useSWR<SettingsView>(key, fetcher)
  return { raw: data?.raw ?? {}, isLoading, error }
}
