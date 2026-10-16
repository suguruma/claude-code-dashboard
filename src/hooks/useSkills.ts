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

  async function archiveSkill(dirName: string) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate(`/api/skills/${dirName}/archive?projectId=${encodeURIComponent(projectId)}`, "POST")
  }

  async function archiveAllSkills() {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    // fsへの同時書き込みを避けるため直列で実行する
    for (const skill of data?.skills ?? []) {
      await apiMutate(
        `/api/skills/${skill.dirName}/archive?projectId=${encodeURIComponent(projectId)}`,
        "POST"
      )
    }
  }

  async function restoreSkillVersion(dirName: string, model: string) {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    await apiMutate(`/api/skills/${dirName}/restore?projectId=${encodeURIComponent(projectId)}`, "POST", {
      model,
    })
    await mutate()
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
    archiveSkill,
    archiveAllSkills,
    restoreSkillVersion,
    disableSkill,
    enableSkill,
  }
}

interface ArchivedVersionsResponse {
  versions: { model: string; updatedAt?: string }[]
}

export function useSkillArchiveVersions(projectId: string | null, dirName: string | null) {
  const key =
    projectId && dirName
      ? `/api/skills/${dirName}/archive?projectId=${encodeURIComponent(projectId)}`
      : null
  const { data, error, isLoading, mutate } = useSWR<ArchivedVersionsResponse>(key, fetcher)
  return { versions: data?.versions ?? [], isLoading, error, mutate }
}
