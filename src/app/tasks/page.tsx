"use client"

import { useState } from "react"
import { useProjects } from "@/hooks/useProjects"
import { useTaskSessions } from "@/hooks/useTaskSessions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { TaskSessionList } from "@/components/tasks/TaskSessionList"
import { TaskItem } from "@/components/tasks/TaskItem"

export default function TasksPage() {
  const { selectedProjectId, selectedProject, isLoading: projectsLoading } = useProjects()
  const { sessions, isLoading, error } = useTaskSessions(selectedProjectId)
  const [manuallySelectedSessionId, setManuallySelectedSessionId] = useState<string | null>(null)

  const selectedSessionId = manuallySelectedSessionId ?? sessions[0]?.sessionId ?? null
  const selectedSession = sessions.find((s) => s.sessionId === selectedSessionId) ?? null

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
        <h1 className="text-xl font-semibold">タスク実行履歴</h1>
        <p className="text-sm text-muted-foreground">
          {selectedProject.name} の .claude/tasks/&lt;セッション&gt;/*.json を可視化します（読み取り専用）
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>読み込みエラー</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {!isLoading && sessions.length === 0 && !error && (
        <Alert>
          <AlertTitle>タスク履歴が見つかりません</AlertTitle>
          <AlertDescription>
            このプロジェクトの配下に `tasks/&lt;セッション&gt;/*.json`
            が見つかりませんでした。TaskCreate/TaskUpdateツールで作成したタスクがある
            Claude Code セッションのホームディレクトリを登録している場合のみ表示されます。
          </AlertDescription>
        </Alert>
      )}

      {sessions.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
          <TaskSessionList
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelect={setManuallySelectedSessionId}
          />

          {selectedSession && (
            <div className="space-y-2">
              {selectedSession.tasks.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
