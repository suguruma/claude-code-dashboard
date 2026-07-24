"use client"

import { useProjects } from "@/hooks/useProjects"
import { useExportImport } from "@/hooks/useExportImport"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ExportPanel } from "@/components/migrate/ExportPanel"
import { ImportPanel } from "@/components/migrate/ImportPanel"

export default function MigratePage() {
  const { selectedProjectId, selectedProject, isLoading: projectsLoading } = useProjects()
  const { exportUrl } = useExportImport(selectedProjectId)

  if (projectsLoading) {
    return <p className="text-sm text-muted-foreground">読み込み中...</p>
  }

  if (!selectedProject || !selectedProjectId) {
    return (
      <Alert>
        <AlertTitle>プロジェクトが未登録です</AlertTitle>
        <AlertDescription>画面右上の「+」からプロジェクトを登録してください。</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">移行（エクスポート / インポート）</h1>
        <p className="text-sm text-muted-foreground">
          {selectedProject.name} のルール・スキルを他のPCへ持ち出したり、他のPCの設定を取り込んだりできます。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ExportPanel exportUrl={exportUrl()} />
        <ImportPanel projectId={selectedProjectId} />
      </div>
    </div>
  )
}
