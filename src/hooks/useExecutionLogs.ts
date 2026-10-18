"use client"

import useSWR from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import { ExecutionLogFile } from "@/lib/types"

/** API の応答。skipped は、task_id が無いなどで表示できずに除いた要素の数 */
interface ExecutionLogResponse extends ExecutionLogFile {
  skipped?: number
}

export function useExecutionLogs(projectId: string | null) {
  const key = projectId
    ? `/api/execution-log?projectId=${encodeURIComponent(projectId)}`
    : null
  const { data, error, isLoading, mutate } = useSWR<ExecutionLogResponse>(key, fetcher)

  async function saveSuggestedRules(taskId: string, targetProjectId?: string): Promise<number> {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    const res = await apiMutate<{ ok: boolean; savedCount: number }>(
      `/api/execution-log/${encodeURIComponent(taskId)}/suggested-rules?projectId=${encodeURIComponent(projectId)}`,
      "POST",
      targetProjectId ? { targetProjectId } : undefined
    )
    return res.savedCount
  }

  async function deleteLog(taskId: string): Promise<void> {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate<{ ok: boolean }>(
      `/api/execution-log/${encodeURIComponent(taskId)}?projectId=${encodeURIComponent(projectId)}`,
      "DELETE"
    )
    await mutate()
  }

  return {
    logs: data?.logs ?? [],
    skipped: data?.skipped ?? 0,
    isLoading,
    error,
    mutate,
    saveSuggestedRules,
    deleteLog,
  }
}
