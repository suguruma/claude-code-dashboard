"use client"

import useSWR, { mutate as globalMutate } from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import { SkillMeta } from "@/lib/types"
import { skillTrashKey } from "@/hooks/useSkillTrash"

interface SkillsResponse {
  skills: SkillMeta[]
}

export function useSkills(projectId: string | null) {
  const key = projectId ? `/api/skills?projectId=${encodeURIComponent(projectId)}` : null
  const { data, error, isLoading, mutate } = useSWR<SkillsResponse>(key, fetcher)

  async function createSkill(input: {
    dirName: string
    description: string
    body: string
    category?: string
    title?: string
    targetModel?: string
  }) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate<SkillMeta>(`/api/skills?projectId=${encodeURIComponent(projectId)}`, "POST", input)
    await mutate()
  }

  async function updateSkill(
    dirName: string,
    patch: {
      description?: string
      body?: string
      category?: string
      title?: string
      targetModel?: string
    }
  ) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate<SkillMeta>(
      `/api/skills/${dirName}?projectId=${encodeURIComponent(projectId)}`,
      "PATCH",
      patch
    )
    await mutate()
  }

  async function deleteSkill(dirName: string) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate(`/api/skills/${dirName}?projectId=${encodeURIComponent(projectId)}`, "DELETE")
    await mutate()
    // 削除したスキルは「削除済みスキル」へ移るので、その一覧も更新する
    await globalMutate(skillTrashKey(projectId))
  }

  async function renameSkill(oldDirName: string, newDirName: string) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    const skill = await apiMutate<SkillMeta>(
      `/api/skills/${oldDirName}/rename?projectId=${encodeURIComponent(projectId)}`,
      "POST",
      { newDirName }
    )
    await mutate()
    return skill
  }

  async function disableSkill(dirName: string) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate(`/api/skills/${dirName}/disable?projectId=${encodeURIComponent(projectId)}`, "POST")
    await mutate()
  }

  async function enableSkill(dirName: string) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate(`/api/skills/${dirName}/enable?projectId=${encodeURIComponent(projectId)}`, "POST")
    await mutate()
  }

  return {
    skills: data?.skills ?? [],
    isLoading,
    error,
    createSkill,
    updateSkill,
    deleteSkill,
    renameSkill,
    disableSkill,
    enableSkill,
  }
}
