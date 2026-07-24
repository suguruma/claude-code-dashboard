"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import { BackupEntry } from "@/lib/types"

export function useBackups(projectId: string | null) {
  const key = projectId ? `/api/backups?projectId=${encodeURIComponent(projectId)}` : null
  const { data, error, isLoading } = useSWR<{ backups: BackupEntry[] }>(key, fetcher)
  return { backups: data?.backups ?? [], isLoading, error }
}
