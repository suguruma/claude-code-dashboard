"use client"

import Link from "next/link"
import { ArrowRight, ListChecks, Activity, Cpu } from "lucide-react"
import { useProjects } from "@/hooks/useProjects"
import { useRules } from "@/hooks/useRules"
import { useExecutionLogs } from "@/hooks/useExecutionLogs"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"

export default function HomePage() {
  const { selectedProject, isLoading: projectsLoading } = useProjects()
  const { rules } = useRules(selectedProject?.id ?? null)
  const { logs } = useExecutionLogs(selectedProject?.id ?? null)

  const enabledCount = rules.filter((r) => r.enabled).length
  const latestLog = logs[0]

  if (projectsLoading) {
    return <p className="text-sm text-muted-foreground">読み込み中...</p>
  }

  if (!selectedProject) {
    return (
      <Alert>
        <AlertTitle>プロジェクトが未登録です</AlertTitle>
        <AlertDescription>
          画面右上の「+」から、rules.json / execution_log.json / CLAUDE.md を配置している
          Claude Code プロジェクトのルートパスを登録してください。
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{selectedProject.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">{selectedProject.path}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>有効ルール数</CardDescription>
            <CardTitle className="text-2xl">
              {enabledCount}
              <span className="text-sm font-normal text-muted-foreground"> / {rules.length}</span>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>記録済みタスク数</CardDescription>
            <CardTitle className="text-2xl">{logs.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>直近の 1-Shot 達成度</CardDescription>
            <CardTitle className="text-2xl">
              {latestLog ? `${latestLog.one_shot_score}点` : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/rules">
          <Card className="h-full transition-colors hover:border-primary">
            <CardHeader>
              <ListChecks className="size-5 text-primary" />
              <CardTitle className="text-base">ルール & スキル管理</CardTitle>
              <CardDescription>
                CLAUDE.md / rules.json のカテゴリ別表示・トグル・編集
              </CardDescription>
            </CardHeader>
            <CardContent>
              <span className="inline-flex items-center gap-1 text-sm text-primary">
                開く <ArrowRight className="size-3.5" />
              </span>
            </CardContent>
          </Card>
        </Link>

        <Link href="/trace">
          <Card className="h-full transition-colors hover:border-primary">
            <CardHeader>
              <Activity className="size-5 text-primary" />
              <CardTitle className="text-base">実行ログ可視化</CardTitle>
              <CardDescription>
                エージェント議論・合意度・介入ポイントの振り返り
              </CardDescription>
            </CardHeader>
            <CardContent>
              <span className="inline-flex items-center gap-1 text-sm text-primary">
                開く <ArrowRight className="size-3.5" />
              </span>
            </CardContent>
          </Card>
        </Link>

        <Card className="h-full opacity-60">
          <CardHeader>
            <Cpu className="size-5 text-muted-foreground" />
            <CardTitle className="text-base flex items-center gap-2">
              GPUモード
              <Badge variant="outline">次回実装予定</Badge>
            </CardTitle>
            <CardDescription>
              ローカルLLM（Ollama等）によるルール矛盾・重複の自動検出
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}
