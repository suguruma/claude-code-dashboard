"use client"

import useSWR from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import { SkillMeta } from "@/lib/types"

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
  }) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate<SkillMeta>(`/api/skills?projectId=${encodeURIComponent(projectId)}`, "POST", input)
    await mutate()
  }

  async function updateSkill(
    dirName: string,
    patch: { description?: string; body?: string; category?: string }
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

  return {
    skills: data?.skills ?? [],
    isLoading,
    error,
    createSkill,
    updateSkill,
    deleteSkill,
    renameSkill,
  }
}
