"use client"

import useSWR from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import { BackupEntry, BackupKind } from "@/lib/types"

export function useBackups(projectId: string | null) {
  const key = projectId ? `/api/backups?projectId=${encodeURIComponent(projectId)}` : null
  const { data, error, isLoading, mutate } = useSWR<{ backups: BackupEntry[] }>(key, fetcher)

  async function restoreBackup(fileName: string, kind: BackupKind, location?: string) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate(`/api/backups/restore?projectId=${encodeURIComponent(projectId)}`, "POST", {
      fileName,
      kind,
      location,
    })
    await mutate()
  }

  return { backups: data?.backups ?? [], isLoading, error, restoreBackup }
}
