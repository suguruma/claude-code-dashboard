"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import { BlockedPlugin } from "@/lib/types"

export function useBlockedPlugins(projectId: string | null) {
  const key = projectId ? `/api/plugins?projectId=${encodeURIComponent(projectId)}` : null
  const { data, error, isLoading } = useSWR<{ blockedPlugins: BlockedPlugin[] }>(key, fetcher)
  return { blockedPlugins: data?.blockedPlugins ?? [], isLoading, error }
}
