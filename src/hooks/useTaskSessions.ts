"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import { TaskSession } from "@/lib/types"

export function useTaskSessions(projectId: string | null) {
  const key = projectId ? `/api/tasks?projectId=${encodeURIComponent(projectId)}` : null
  const { data, error, isLoading } = useSWR<{ sessions: TaskSession[] }>(key, fetcher)
  return { sessions: data?.sessions ?? [], isLoading, error }
}
