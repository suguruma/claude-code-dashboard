"use client"

import useSWR from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import { RuleRefactorApplyResult, RuleRefactorDiffResult } from "@/lib/types"

export function useRuleRefactor(projectId: string | null) {
  const key = projectId ? `/api/refactor/diff?projectId=${encodeURIComponent(projectId)}` : null
  const { data, error, isLoading, mutate } = useSWR<RuleRefactorDiffResult>(key, fetcher)

  async function applyProposal(selectedIndexes: number[]): Promise<RuleRefactorApplyResult> {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    const result = await apiMutate<RuleRefactorApplyResult>(
      `/api/refactor/apply?projectId=${encodeURIComponent(projectId)}`,
      "POST",
      { selectedIndexes }
    )
    await mutate()
    return result
  }

  return {
    generatedAt: data?.generatedAt ?? null,
    items: data?.items ?? [],
    isLoading,
    error,
    applyProposal,
    refresh: () => mutate(),
  }
}
