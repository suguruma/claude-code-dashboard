"use client"

import useSWR from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import { ExecutionLogFile } from "@/lib/types"

export function useExecutionLogs(projectId: string | null) {
  const key = projectId
    ? `/api/execution-log?projectId=${encodeURIComponent(projectId)}`
    : null
  const { data, error, isLoading, mutate } = useSWR<ExecutionLogFile>(key, fetcher)

  async function saveSuggestedRules(taskId: string): Promise<number> {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    const res = await apiMutate<{ ok: boolean; savedCount: number }>(
      `/api/execution-log/${taskId}/suggested-rules?projectId=${encodeURIComponent(projectId)}`,
      "POST"
    )
    return res.savedCount
  }

  return {
    logs: data?.logs ?? [],
    isLoading,
    error,
    mutate,
    saveSuggestedRules,
  }
}
