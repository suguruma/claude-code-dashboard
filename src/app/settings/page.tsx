"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"
import { useProjects } from "@/hooks/useProjects"
import { useSettings } from "@/hooks/useSettings"
import { useBackups } from "@/hooks/useBackups"
import { useBlockedPlugins } from "@/hooks/usePlugins"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BackupList } from "@/components/settings/BackupList"
import { PluginBlocklist } from "@/components/settings/PluginBlocklist"
import { SettingsEditDialog } from "@/components/settings/SettingsEditDialog"

const KNOWN_KEYS = [
  "permissions",
  "env",
  "statusLine",
  "hooks",
  "autoUpdatesChannel",
  "agentPushNotifEnabled",
] as const

function KeyValueTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">なし</p>
  return (
    <div className="space-y-1 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-start justify-between gap-3 border-b py-1 last:border-b-0">
          <span className="font-mono text-muted-foreground">{key}</span>
          <span className="min-w-0 flex-1 truncate text-right font-mono">
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function SettingsPage() {
  const { selectedProjectId, selectedProject, isLoading: projectsLoading } = useProjects()
  const { raw, isLoading, error, updateSettings } = useSettings(selectedProjectId)
  const {
    backups,
    isLoading: backupsLoading,
    error: backupsError,
    restoreBackup,
  } = useBackups(selectedProjectId)
  const {
    blockedPlugins,
    isLoading: pluginsLoading,
    error: pluginsError,
  } = useBlockedPlugins(selectedProjectId)
  const [editDialogOpen, setEditDialogOpen] = useState(false)

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

  const permissions = (raw.permissions as Record<string, unknown>) ?? {}
  const env = (raw.env as Record<string, unknown>) ?? {}
  const statusLine = (raw.statusLine as Record<string, unknown>) ?? {}
  const otherEntries = Object.fromEntries(
    Object.entries(raw).filter(([k]) => !KNOWN_KEYS.includes(k as (typeof KNOWN_KEYS)[number]))
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">設定 & システム情報</h1>
        <p className="text-sm text-muted-foreground">
          {selectedProject.name} の settings.json / backups / plugins を表示します（プラグインは読み取り専用）
        </p>
      </div>

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">設定</TabsTrigger>
          <TabsTrigger value="backups">バックアップ</TabsTrigger>
          <TabsTrigger value="plugins">プラグイン</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
              <Pencil className="size-3.5" />
              編集する
            </Button>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>読み込みエラー</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          {!isLoading && Object.keys(raw).length === 0 && !error && (
            <Alert>
              <AlertTitle>settings.json が見つかりません</AlertTitle>
              <AlertDescription>
                このプロジェクトの配下に settings.json が見つかりませんでした。
              </AlertDescription>
            </Alert>
          )}

          {Object.keys(raw).length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    権限モード
                    {typeof permissions.defaultMode === "string" && (
                      <Badge variant="outline">{permissions.defaultMode}</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <KeyValueTable data={permissions} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">環境変数</CardTitle>
                </CardHeader>
                <CardContent>
                  <KeyValueTable data={env} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">statusLine</CardTitle>
                </CardHeader>
                <CardContent>
                  <KeyValueTable data={statusLine} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">その他の設定</CardTitle>
                </CardHeader>
                <CardContent>
                  <KeyValueTable data={otherEntries} />
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="backups" className="space-y-4">
          {backupsError && (
            <Alert variant="destructive">
              <AlertTitle>読み込みエラー</AlertTitle>
              <AlertDescription>{backupsError.message}</AlertDescription>
            </Alert>
          )}
          {!backupsLoading && !backupsError && (
            <BackupList
              backups={backups}
              isGlobalConfig={selectedProject.isGlobalConfig}
              onRestore={restoreBackup}
            />
          )}
        </TabsContent>

        <TabsContent value="plugins" className="space-y-4">
          {pluginsError && (
            <Alert variant="destructive">
              <AlertTitle>読み込みエラー</AlertTitle>
              <AlertDescription>{pluginsError.message}</AlertDescription>
            </Alert>
          )}
          {!pluginsLoading && !pluginsError && <PluginBlocklist blockedPlugins={blockedPlugins} />}
        </TabsContent>
      </Tabs>

      <SettingsEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        raw={raw}
        isGlobalConfig={selectedProject.isGlobalConfig}
        onSave={updateSettings}
      />
    </div>
  )
}
