"use client"

import { useMemo, useState } from "react"
import { ChevronRight } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useMemoryEntries, useMemoryProjects } from "@/hooks/useMemory"
import { useProjects } from "@/hooks/useProjects"
import { cn } from "@/lib/utils"
import { MemoryEntryCard } from "./MemoryEntryCard"
import { MemoryProjectList } from "./MemoryProjectList"

const TYPE_FILTERS = ["all", "user", "feedback", "project", "reference"] as const

/**
 * 記憶の一覧(⑬ の棚卸しの行34。メモリ管理のページから、組織の「決まり」へまとめた)。
 * 選んでいるプロジェクトの .claude/projects/*\/memory/*.md を、種類別に絞り込んで読む(読み取り専用)。
 * 記憶は数が多く本文も長いので、初めは閉じておき、開いたときだけ取りに行く。
 */
export function MemoryBrowser() {
  const [open, setOpen] = useState(false)
  const { selectedProject } = useProjects()
  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-1 rounded-md text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden />
        {open ? "記憶の一覧を閉じる" : "記憶の一覧を開く"}
      </button>
      <p className="text-sm text-muted-foreground">
        選んでいるプロジェクト{selectedProject ? `（${selectedProject.name}）` : ""}の記憶を、種類（user・feedback・project・reference）で絞り込んで読みます。プロジェクトは、ルール管理などのページの上のバーで切り替えます。
      </p>
      {open && <MemoryBody />}
    </div>
  )
}

function MemoryBody() {
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

  if (projectsLoading) return <p className="text-sm text-muted-foreground">読み込み中...</p>
  if (!selectedProject) {
    return <p className="text-sm text-muted-foreground">プロジェクトが未登録です。ルール管理などのページの上のバーの「+」から登録してください。</p>
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>読み込みエラー</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {!isLoading && memoryProjects.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          このプロジェクトの配下に projects/&lt;プロジェクト&gt;/memory/*.md が見つかりませんでした。実際の Claude Code ユーザーホーム（~/.claude）をプロジェクトとして登録している場合のみ表示されます。
        </p>
      )}

      {memoryProjects.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
          <MemoryProjectList projects={memoryProjects} selectedDirName={selectedDirName} onSelect={setManuallySelectedDir} />

          <div className="min-w-0 space-y-4">
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
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
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
