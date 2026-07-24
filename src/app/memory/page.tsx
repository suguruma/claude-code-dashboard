"use client"

import { useMemo, useState } from "react"
import { useProjects } from "@/hooks/useProjects"
import { useMemoryEntries, useMemoryProjects } from "@/hooks/useMemory"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MemoryProjectList } from "@/components/memory/MemoryProjectList"
import { MemoryEntryCard } from "@/components/memory/MemoryEntryCard"

const TYPE_FILTERS = ["all", "user", "feedback", "project", "reference"] as const

export default function MemoryPage() {
  const { selectedProjectId, selectedProject, isLoading: projectsLoading } = useProjects()
  const { memoryProjects, isLoading, error } = useMemoryProjects(selectedProjectId)
  const [manuallySelectedDir, setManuallySelectedDir] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>("all")

  const selectedDirName = manuallySelectedDir ?? memoryProjects[0]?.dirName ?? null
  const { entries } = useMemoryEntries(selectedProjectId, selectedDirName)

  const filteredEntries = useMemo(() => {
    if (typeFilter === "all") return entries
    return entries.filter((e) => e.type === typeFilter)
  }, [entries, typeFilter])

  if (projectsLoading) {
    return <p className="text-sm text-muted-foreground">読み込み中...</p>
  }

  if (!selectedProject) {
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
        <h1 className="text-xl font-semibold">メモリ管理</h1>
        <p className="text-sm text-muted-foreground">
          {selectedProject.name} の .claude/projects/*/memory/*.md を横断的に閲覧します（読み取り専用）
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>読み込みエラー</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {!isLoading && memoryProjects.length === 0 && !error && (
        <Alert>
          <AlertTitle>メモリデータが見つかりません</AlertTitle>
          <AlertDescription>
            このプロジェクトの配下に `projects/&lt;プロジェクト&gt;/memory/*.md`
            が見つかりませんでした。実際の Claude Code ユーザーホーム（`~/.claude`）を
            プロジェクトとして登録している場合のみ表示されます。
          </AlertDescription>
        </Alert>
      )}

      {memoryProjects.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
          <MemoryProjectList
            projects={memoryProjects}
            selectedDirName={selectedDirName}
            onSelect={setManuallySelectedDir}
          />

          <div className="space-y-4">
            <Tabs value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
              <TabsList>
                {TYPE_FILTERS.map((t) => (
                  <TabsTrigger key={t} value={t}>
                    {t === "all" ? "すべて" : t}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {filteredEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">該当するメモリがありません。</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {filteredEntries.map((entry) => (
                  <MemoryEntryCard key={entry.fileName} entry={entry} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
