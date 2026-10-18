"use client"

import { Suspense, useCallback, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { NotificationToggle } from "@/components/desktopSessions/NotificationToggle"
import { SessionDetailDialog } from "@/components/desktopSessions/SessionDetailDialog"
import { SessionRow } from "@/components/desktopSessions/SessionRow"
import { SummaryCards } from "@/components/desktopSessions/SummaryCards"
import { UsageGuardBand } from "@/components/desktopSessions/UsageGuardBand"
import { UsagePanel } from "@/components/desktopSessions/UsagePanel"
import { useDesktopSessions } from "@/hooks/useDesktopSessions"
import { useUsage } from "@/hooks/useUsage"
import { usePersistedState } from "@/hooks/useLocalStorage"
import {
  DEFAULT_FILTERS,
  applyFilters,
  bucketByGroup,
  collectOptions,
  visibleGroups,
  type DesktopSessionFilters,
} from "@/lib/desktopSessionFilters"

const FILTER_STORAGE_KEY = "ccd:desktop-sessions:filters"

const STATUS_OPTIONS: Array<{ value: DesktopSessionFilters["status"]; label: string }> = [
  { value: "all", label: "すべての状態" },
  { value: "running", label: "実行中（推定）" },
  { value: "blocked", label: "要対応" },
  { value: "review_ready", label: "確認待ち" },
  { value: "completed", label: "完了" },
  { value: "interrupted", label: "中断の可能性" },
  { value: "waiting", label: "入力待ち" },
  { value: "error", label: "エラー" },
  { value: "highContext", label: "コンテキスト使用率が高い" },
]

const selectClass =
  "h-8 min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"

export default function DesktopSessionsPage() {
  // useSearchParams を使うため、静的生成時のためにSuspenseで包む
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">読み込み中...</p>}>
      <DesktopSessionsContent />
    </Suspense>
  )
}

function DesktopSessionsContent() {
  const { data, error, isLoading } = useDesktopSessions()
  const { data: usage } = useUsage()
  const [stored, setFilters] = usePersistedState<DesktopSessionFilters>(FILTER_STORAGE_KEY, DEFAULT_FILTERS)
  // 保存された値に新しい項目が無い場合に備えて、既定値で埋める
  const filters = useMemo(() => ({ ...DEFAULT_FILTERS, ...stored }), [stored])
  // 詳細を開いているセッションはURLの ?session= で持つ。通知のクリックから、そのセッションの詳細を直接開ける
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get("session")
  const setSelectedId = useCallback(
    (id: string | null) => {
      router.replace(id ? `${pathname}?session=${encodeURIComponent(id)}` : pathname, { scroll: false })
    },
    [router, pathname]
  )

  const sessions = useMemo(() => data?.sessions ?? [], [data])
  const highContextRatio = data?.highContextRatio ?? 0.8
  const filtered = useMemo(
    () => applyFilters(sessions, filters, highContextRatio),
    [sessions, filters, highContextRatio]
  )
  const models = useMemo(() => collectOptions(sessions, (s) => s.model), [sessions])
  const folders = useMemo(() => collectOptions(sessions, (s) => s.folderName), [sessions])
  // 件数0のグループは選択肢から隠す(アーカイブ済みを含める設定のときは、その件数で判定する)
  const groupOptions = useMemo(
    () => visibleGroups(data?.groups ?? [], sessions, filters.includeArchived, filters.group),
    [data?.groups, sessions, filters.includeArchived, filters.group]
  )
  const buckets = useMemo(
    () => (filters.view === "group" ? bucketByGroup(filtered, data?.groups ?? []) : []),
    [filtered, filters.view, data?.groups]
  )

  function update(patch: Partial<DesktopSessionFilters>) {
    setFilters({ ...filters, ...patch })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Desktopセッション</h1>
        <p className="text-sm text-muted-foreground">
          Claude Desktopの全セッションを一覧し、どれが動いていて、どれが止まっているかを確認します（読み取り専用・5秒ごとに更新）。
          状態の「実行中」「中断の可能性」は、会話ログの更新状況からの推定です。
        </p>
      </div>

      {/* 最新の公式値が80%以上のときの上限ガードの帯(表示のみ) */}
      <UsageGuardBand guard={usage?.guard} />

      <NotificationToggle />

      <UsagePanel />

      {error && (
        <Alert variant="destructive">
          <AlertTitle>読み込みエラー</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {data?.source === "none" && (
        <Alert>
          <AlertTitle>セッションが見つかりません</AlertTitle>
          <AlertDescription>
            Claude Desktopのデータフォルダも、会話ログ（<code className="font-mono">~/.claude/projects/</code>）も見つかりませんでした。
            データフォルダが標準の場所にない場合は、設定ファイル <code className="font-mono">config/desktop-sessions.json</code> の
            <code className="font-mono"> dataDir</code> で指定できます。
          </AlertDescription>
        </Alert>
      )}

      {data?.warnings.map((warning) => (
        <Alert key={warning} variant={data.source === "transcript-only" ? "destructive" : "default"}>
          <AlertTitle>{data.source === "transcript-only" && warning === data.warnings[0] ? "縮退表示" : "お知らせ"}</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      {isLoading && !data && <p className="text-sm text-muted-foreground">読み込み中...</p>}

      {data && data.source !== "none" && (
        <>
          <SummaryCards
            counts={data.counts}
            highContextRatio={highContextRatio}
            selected={filters.status}
            onSelect={(status) => update({ status })}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <select
              aria-label="状態で絞り込む"
              className={selectClass}
              value={filters.status}
              onChange={(e) => update({ status: e.target.value as DesktopSessionFilters["status"] })}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {groupOptions.length > 0 && (
              <select
                aria-label="グループで絞り込む"
                className={selectClass}
                value={filters.group}
                onChange={(e) => update({ group: e.target.value })}
              >
                <option value="all">すべてのグループ</option>
                {groupOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}（{g.count}）
                  </option>
                ))}
                <option value="none">グループなし</option>
              </select>
            )}
            <select
              aria-label="モデルで絞り込む"
              className={selectClass}
              value={filters.model}
              onChange={(e) => update({ model: e.target.value })}
            >
              <option value="all">すべてのモデル</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              aria-label="作業フォルダで絞り込む"
              className={selectClass}
              value={filters.folder}
              onChange={(e) => update({ folder: e.target.value })}
            >
              <option value="all">すべての作業フォルダ</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <Switch
                id="include-archived"
                checked={filters.includeArchived}
                onCheckedChange={(checked) => update({ includeArchived: checked })}
              />
              <Label htmlFor="include-archived" className="text-sm text-muted-foreground">
                アーカイブ済みを含める（{data.counts.archived}件）
              </Label>
            </div>
            {groupOptions.length > 0 && (
              <div className="flex items-center gap-2">
                <Switch
                  id="group-view"
                  checked={filters.view === "group"}
                  onCheckedChange={(checked) => update({ view: checked ? "group" : "list" })}
                />
                <Label htmlFor="group-view" className="text-sm text-muted-foreground">
                  グループ別に表示
                </Label>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {filtered.length}件を表示中（全{sessions.length}件）。{data.contextLimitNote}
          </p>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">条件に合うセッションがありません。</p>
          ) : filters.view === "group" ? (
            <div className="space-y-5">
              {buckets.map((bucket) => (
                <section key={bucket.key} className="space-y-2">
                  <h2 className="text-sm font-medium">
                    {bucket.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{bucket.sessions.length}件</span>
                  </h2>
                  <div className="space-y-2">
                    {bucket.sessions.map((s) => (
                      <SessionRow key={s.id} session={s} highContextRatio={highContextRatio} onSelect={setSelectedId} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((s) => (
                <SessionRow key={s.id} session={s} highContextRatio={highContextRatio} onSelect={setSelectedId} />
              ))}
            </div>
          )}
        </>
      )}

      <SessionDetailDialog
        sessionId={selectedId}
        highContextRatio={highContextRatio}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}
