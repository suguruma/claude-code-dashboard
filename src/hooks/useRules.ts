"use client"

import useSWR from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import { Rule } from "@/lib/types"

interface RulesResponse {
  rules: Rule[]
}

export function useRules(projectId: string | null) {
  const key = projectId ? `/api/rules?projectId=${encodeURIComponent(projectId)}` : null
  const { data, error, isLoading, mutate } = useSWR<RulesResponse>(key, fetcher)

  async function createRule(input: { category: string; content: string; enabled?: boolean }) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate<Rule>(`/api/rules?projectId=${encodeURIComponent(projectId)}`, "POST", input)
    await mutate()
  }

  async function updateRule(
    id: string,
    patch: Partial<Pick<Rule, "category" | "content" | "enabled">>
  ) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await mutate(async (current) => {
      await apiMutate<Rule>(
        `/api/rules/${id}?projectId=${encodeURIComponent(projectId)}`,
        "PATCH",
        patch
      )
      if (!current) return current
      return {
        rules: current.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      }
    }, { revalidate: true })
  }

  async function deleteRule(id: string) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate(`/api/rules/${id}?projectId=${encodeURIComponent(projectId)}`, "DELETE")
    await mutate()
  }

  async function reorderRules(orderedIds: string[]) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await mutate(async (current) => {
      await apiMutate<RulesResponse>(
        `/api/rules/reorder?projectId=${encodeURIComponent(projectId)}`,
        "POST",
        { orderedIds }
      )
      if (!current) return current
      const byId = new Map(current.rules.map((r) => [r.id, r]))
      return { rules: orderedIds.map((id) => byId.get(id)!) }
    }, { revalidate: true, rollbackOnError: true })
  }

  return {
    rules: data?.rules ?? [],
    isLoading,
    error,
    createRule,
    updateRule,
    deleteRule,
    reorderRules,
  }
}
