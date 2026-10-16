"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { DirEntry, FilePreviewResult } from "@/lib/dirBrowser"

export interface DirBrowseResponse {
  path: string | null
  parentPath: string | null
  entries: DirEntry[]
  shortcuts: { label: string; path: string }[]
}

export function useDirBrowser(targetPath: string | null, enabled: boolean = true) {
  const key = enabled ? `/api/browse-dir?path=${encodeURIComponent(targetPath ?? "")}` : null
  const { data, error, isLoading } = useSWR<DirBrowseResponse>(key, fetcher)

  return {
    path: data?.path ?? null,
    parentPath: data?.parentPath ?? null,
    entries: data?.entries ?? [],
    shortcuts: data?.shortcuts ?? [],
    isLoading,
    error,
  }
}

export function useFilePreview(filePath: string | null) {
  const key = filePath ? `/api/browse-dir/preview?path=${encodeURIComponent(filePath)}` : null
  const { data, error, isLoading } = useSWR<FilePreviewResult>(key, fetcher)

  return {
    content: data?.content ?? "",
    truncated: data?.truncated ?? false,
    binary: data?.binary ?? false,
    isLoading,
    error,
  }
}
