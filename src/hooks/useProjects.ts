"use client"

import useSWR from "swr"
import { apiMutate, fetcher } from "@/lib/fetcher"
import { ProjectConfig, ProjectsFile } from "@/lib/types"

const PROJECTS_KEY = "/api/projects"

export function useProjects() {
  const { data, error, isLoading, mutate } = useSWR<ProjectsFile>(PROJECTS_KEY, fetcher)

  const projects: ProjectConfig[] = data?.projects ?? []
  const selectedProjectId: string | null = data?.selectedProjectId ?? null
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null

  async function selectProject(id: string) {
    await mutate(async (current) => {
      await apiMutate(PROJECTS_KEY, "PATCH", { selectedProjectId: id })
      return current ? { ...current, selectedProjectId: id } : current
    }, { revalidate: true })
  }

  async function addProject(name: string, path: string) {
    await apiMutate<ProjectConfig>(PROJECTS_KEY, "POST", { name, path })
    await mutate()
  }

  async function removeProject(id: string) {
    await apiMutate(`/api/projects/${id}`, "DELETE")
    await mutate()
  }

  return {
    projects,
    selectedProjectId,
    selectedProject,
    isLoading,
    error,
    selectProject,
    addProject,
    removeProject,
  }
}
