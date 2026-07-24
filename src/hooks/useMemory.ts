"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import { MemoryEntry, MemoryProject } from "@/lib/types"

export function useMemoryProjects(projectId: string | null) {
  const key = projectId ? `/api/memory?projectId=${encodeURIComponent(projectId)}` : null
  const { data, error, isLoading } = useSWR<{ memoryProjects: MemoryProject[] }>(key, fetcher)
  return { memoryProjects: data?.memoryProjects ?? [], isLoading, error }
}

export function useMemoryEntries(projectId: string | null, dirName: string | null) {
  const key =
    projectId && dirName
      ? `/api/memory/${encodeURIComponent(dirName)}?projectId=${encodeURIComponent(projectId)}`
      : null
  const { data, error, isLoading } = useSWR<{ entries: MemoryEntry[] }>(key, fetcher)
  return { entries: data?.entries ?? [], isLoading, error }
}
