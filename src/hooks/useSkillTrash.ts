"use client"

import useSWR, { mutate as globalMutate } from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import { TrashedSkill } from "@/lib/types"

interface SkillTrashResponse {
  items: TrashedSkill[]
  trashPath: string
}

export function skillTrashKey(projectId: string | null): string | null {
  return projectId ? `/api/skills-trash?projectId=${encodeURIComponent(projectId)}` : null
}

/** 削除済みスキル(`skills-trash/`)の一覧と復元 */
export function useSkillTrash(projectId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<SkillTrashResponse>(skillTrashKey(projectId), fetcher)

  async function restoreTrashedSkill(id: string) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate(`/api/skills-trash?projectId=${encodeURIComponent(projectId)}`, "POST", { id })
    await mutate()
    // 復元したスキルをスキル一覧にも反映する
    await globalMutate(`/api/skills?projectId=${encodeURIComponent(projectId)}`)
  }

  return {
    items: data?.items ?? [],
    trashPath: data?.trashPath ?? null,
    isLoading,
    error,
    restoreTrashedSkill,
  }
}
