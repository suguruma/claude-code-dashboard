"use client"

import useSWR from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import { BackupEntry } from "@/lib/types"

export function useBackups(projectId: string | null) {
  const key = projectId ? `/api/backups?projectId=${encodeURIComponent(projectId)}` : null
  const { data, error, isLoading, mutate } = useSWR<{ backups: BackupEntry[] }>(key, fetcher)

  async function restoreBackup(fileName: string) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate(`/api/backups/restore?projectId=${encodeURIComponent(projectId)}`, "POST", {
      fileName,
    })
    await mutate()
  }

  return { backups: data?.backups ?? [], isLoading, error, restoreBackup }
}
