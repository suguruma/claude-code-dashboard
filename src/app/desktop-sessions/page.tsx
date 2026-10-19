"use client"

import { Suspense, useMemo } from "react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { DesktopDataNotices } from "@/components/desktopSessions/DesktopDataNotices"
import { NotificationToggle } from "@/components/desktopSessions/NotificationToggle"
import { SessionDetailDialog } from "@/components/desktopSessions/SessionDetailDialog"
import { SessionRow } from "@/components/desktopSessions/SessionRow"
import { SummaryCards } from "@/components/desktopSessions/SummaryCards"
import { useDesktopSessions } from "@/hooks/useDesktopSessions"
import { usePersistedState } from "@/hooks/useLocalStorage"
import { useSelectedSession } from "@/hooks/useSelectedSession"
import {
  DEFAULT_FILTERS,
  applyFilters,
  bucketByGroup,
  collectOptions,
  normalizeFilters,
  visibleGroups,
  type DesktopSessionFilters,
} from "@/lib/desktopSessionFilters"

const FILTER_STORAGE_KEY = "ccd:desktop-sessions:filters"

const STATUS_OPTIONS: Array<{ value: DesktopSessionFilters["status"]; label: string }> = [
  { value: "all", label: "すべての状態" },
  { value: "running", label: "実行中（推定）" },
  { value: "blocked", label: "要対応" },
  { value: "standby", label: "待機" },
  { value: "review_ready", label: "確認待ち" },
  { value: "completed", label: "完了" },
  { value: "interrupted", label: "中断の可能性" },
  { value: "waiting", label: "入力待ち" },
  { value: "error", label: "エラー" },
  { value: "highContext", label: "コンテキスト使用率が高い" },
]

/** 組織図と利用上限は、サイドバーの別ページにある */
const VIEW_OPTIONS: Array<{ value: DesktopSessionFilters["view"]; label: string }> = [
  { value: "list", label: "一覧" },
  { value: "group", label: "グループ別" },
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
  const [stored, setFilters] = usePersistedState<DesktopSessionFilters>(FILTER_STORAGE_KEY, DEFAULT_FILTERS)
  // 保存された値に新しい項目が無い場合や、組織図が別ページになる前の値が残っている場合に備えて、今の形に直す
  const filters = useMemo(() => normalizeFilters(stored), [stored])
  const [selectedId, setSelectedId] = useSelectedSession()

  const sessions = useMemo(() => data?.sessions ?? [], [data])
  // サイドチャットの印に出す、親のセッションのタイトル
  const titleById = useMemo(() => new Map(sessions.map((s) => [s.id, s.title] as const)), [sessions])
  const parentTitleOf = (s: (typeof sessions)[number]) =>
    s.isSideChat && s.spawnedFromId ? (titleById.get(s.spawnedFromId) ?? null) : null
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
      <NotificationToggle />

      <DesktopDataNotices data={data} error={error} isLoading={isLoading} />

      {data && data.source !== "none" && (
        <>
          <SummaryCards
            counts={data.counts}
            highContextRatio={highContextRatio}
            selected={filters.status}
            onSelect={(status) => update({ status })}
          />

          <div className="inline-flex overflow-hidden rounded-lg border" role="group" aria-label="表示の切り替え">
            {VIEW_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={filters.view === o.value}
                onClick={() => update({ view: o.value })}
                className={cn(
                  "px-3 py-1.5 text-sm transition-colors",
                  filters.view === o.value ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

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
                      <SessionRow key={s.id} session={s} highContextRatio={highContextRatio} onSelect={setSelectedId} parentTitle={parentTitleOf(s)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((s) => (
                <SessionRow key={s.id} session={s} highContextRatio={highContextRatio} onSelect={setSelectedId} parentTitle={parentTitleOf(s)} />
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
