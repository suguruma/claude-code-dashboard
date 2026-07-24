"use client"

import { apiMutate } from "@/lib/fetcher"
import { ExportBundle, ImportApplyResult, ImportDiffResult } from "@/lib/types"

export function useExportImport(projectId: string | null) {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""

  function exportUrl(): string {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    return `/api/export${qs}`
  }

  async function diffImport(bundle: ExportBundle): Promise<ImportDiffResult> {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    return apiMutate<ImportDiffResult>(`/api/import/diff${qs}`, "POST", { bundle })
  }

  async function applyImport(
    bundle: ExportBundle,
    selection: { ruleCategories: string[]; skillDirNames: string[] }
  ): Promise<ImportApplyResult> {
    if (!projectId) throw new Error("プロジェクトが選択されていません")
    return apiMutate<ImportApplyResult>(`/api/import/apply${qs}`, "POST", {
      bundle,
      ...selection,
    })
  }

  return { exportUrl, diffImport, applyImport }
}
