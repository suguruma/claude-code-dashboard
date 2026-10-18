"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useFlow } from "@/hooks/useFlow"
import { usePersistedState } from "@/hooks/useLocalStorage"
import { visibleGroups } from "@/lib/desktopSessionFilters"
import type { DesktopSessionGroup, DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import {
  advanceReal,
  buildPlaybackMap,
  buildTimeline,
  eventLines,
  formatCtxDelta,
  selectUnseen,
  shouldAnimate,
  stateAt,
  timelineMarks,
  type EventLine,
  type FlowTimeline,
} from "@/lib/flowPlayback"
import { MEMBER_ORDERS, normalizeMemberOrder, orderMembers } from "@/lib/flowOrder"
import { FLOW_DEFAULT_RANGE_MS, type FlowResponse } from "@/lib/flowTypes"
import { cn } from "@/lib/utils"
import { formatJstTime } from "@/lib/usageFormat"
import { OrgChartCanvas, type FxInput, type FxItem, type OrgNode } from "./OrgChartCanvas"
import { OrgReplayControls } from "./OrgReplayControls"

const GROUP_STORAGE_KEY = "ccd:org-chart:group"
const RANGE_STORAGE_KEY = "ccd:org-chart:range"
const ORDER_STORAGE_KEY = "ccd:org-chart:order"
const HOUR_MS = 60 * 60 * 1000
const RANGES = [1, 4, 24] as const
const LOG_LIMIT = 50
/** 同時に起きた出来事の粒を、少しずつずらして流す間隔(ms) */
const STAGGER_MS = 250
const COMMIT_MS = 100

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)"

/** 動きを減らす設定 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(REDUCED_QUERY)
      query.addEventListener("change", listener)
      return () => query.removeEventListener("change", listener)
    },
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false
  )
}

/** 一定間隔で更新される現在時刻(ms) */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

const segClass = (active: boolean) =>
  cn(
    "px-3 py-1.5 text-sm transition-colors",
    active ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted"
  )

interface OrgChartViewProps {
  sessions: DesktopSessionSummary[]
  groups: DesktopSessionGroup[]
  highContextRatio: number
  onSelect: (id: string) => void
}

/** 組織図の表示(グループ別の指揮役と子のカード、指示・報告の信号、ライブと振り返り) */
export function OrgChartView({ sessions, groups, highContextRatio, onSelect }: OrgChartViewProps) {
  const [storedGroup, setStoredGroup] = usePersistedState<string>(GROUP_STORAGE_KEY, "")
  const [storedRange, setStoredRange] = usePersistedState<number>(RANGE_STORAGE_KEY, 4)
  const [storedOrder, setStoredOrder] = usePersistedState<string>(ORDER_STORAGE_KEY, "name")
  const memberOrder = normalizeMemberOrder(storedOrder)
  const options = useMemo(() => visibleGroups(groups, sessions, false, storedGroup), [groups, sessions, storedGroup])
  const groupId = options.find((g) => g.id === storedGroup)?.id ?? options[0]?.id ?? null
  const rangeHours = (RANGES as readonly number[]).includes(storedRange) ? storedRange : FLOW_DEFAULT_RANGE_MS / HOUR_MS
  const rangeMs = rangeHours * HOUR_MS

  const { data: liveFlow, error } = useFlow(groupId, rangeMs)
  const reducedMotion = usePrefersReducedMotion()
  const animate = shouldAnimate(reducedMotion)
  const now = useNow(1_000)

  const [mode, setMode] = useState<"live" | "replay">("live")
  /** 振り返りで見ているデータ。開いた時点のものに固定する(更新で範囲がずれないように) */
  const [frozen, setFrozen] = useState<FlowResponse | null>(null)
  const [replay, setReplay] = useState({ t: 0, playing: false, speed: 300, skipIdle: true })

  const flow = mode === "replay" && frozen ? frozen : liveFlow
  const timeline = useMemo<FlowTimeline | null>(() => (flow ? buildTimeline(flow) : null), [flow])

  // ---- 効果(粒・強調)の待ち行列 ---------------------------------------------
  const [fx, setFx] = useState<FxItem[]>([])
  const fxSeq = useRef(0)
  const pushFx = useCallback((items: FxInput[]) => {
    if (items.length === 0) return
    setFx((prev) => [...prev, ...items.map((item) => ({ ...item, id: ++fxSeq.current }))].slice(-60))
  }, [])

  // ---- ライブ: 新しい出来事だけを流す -------------------------------------------
  const seen = useRef<{ key: string; keys: Set<string> }>({ key: "", keys: new Set() })
  useEffect(() => {
    if (mode !== "live" || !liveFlow) {
      seen.current = { key: "", keys: new Set() }
      return
    }
    const key = `${liveFlow.group.id}|${rangeMs}`
    if (seen.current.key !== key) {
      // 最初の表示(開いた直後・グループや範囲を変えた直後): 過去の出来事は流さず、全件を見たことにする
      seen.current = { key, keys: new Set() }
      selectUnseen(liveFlow.events, seen.current.keys)
      return
    }
    const fresh = selectUnseen(liveFlow.events, seen.current.keys)
    pushFx(fresh.map((event, i) => ({ event, delayMs: i * STAGGER_MS })))
  }, [liveFlow, mode, rangeMs, pushFx])

  // ---- 表示する時刻と状態 ------------------------------------------------------
  const viewTime = mode === "replay" ? replay.t : now
  const chart = useMemo(() => (timeline ? stateAt(timeline, viewTime) : null), [timeline, viewTime])

  // コンテキストの増えた分(「+28K」)の強調: 連続して時刻が進むとき(ライブ・再生中)だけ
  const prevCtx = useRef<{ key: string; ctx: Map<string, number | null> } | null>(null)
  const continuous = mode === "live" || replay.playing
  useEffect(() => {
    if (!chart || !timeline) return
    const key = `${mode}|${timeline.since}`
    const previous = prevCtx.current
    const next = new Map(chart.members.map((m) => [m.id, m.ctx] as const))
    prevCtx.current = { key: mode === "live" ? `live|${flow?.group.id}|${rangeMs}` : key, ctx: next }
    if (!previous || previous.key !== prevCtx.current.key || !continuous) return
    const items: FxInput[] = []
    for (const m of chart.members) {
      const before = previous.ctx.get(m.id)
      if (before == null || m.ctx === null) continue
      const text = formatCtxDelta(m.ctx - before)
      if (text) items.push({ delayMs: 0, delta: { sid: m.id, text } })
    }
    pushFx(items)
  }, [chart, timeline, mode, continuous, flow?.group.id, rangeMs, pushFx])

  // ---- 振り返りの再生 ----------------------------------------------------------
  const playback = useMemo(
    () =>
      timeline
        ? buildPlaybackMap(timelineMarks(timeline), timeline.since, timeline.until, { speed: replay.speed, skipIdle: replay.skipIdle })
        : null,
    [timeline, replay.speed, replay.skipIdle]
  )
  const replayPlaying = mode === "replay" && replay.playing
  useEffect(() => {
    if (!replayPlaying || !timeline || !playback) return
    let frame = 0
    let last = performance.now()
    let lastCommit = last
    let cursor = replay.t
    let pending: FlowResponse["events"] = []
    const tick = (ts: number) => {
      const next = advanceReal(playback, cursor, ts - last)
      last = ts
      pending = pending.concat(timeline.events.filter((e) => e.t > cursor && e.t <= next))
      cursor = next
      const finished = cursor >= timeline.until
      if (finished || ts - lastCommit >= COMMIT_MS) {
        lastCommit = ts
        const events = pending
        pending = []
        setReplay((r) => ({ ...r, t: cursor, playing: !finished }))
        pushFx(events.map((event, i) => ({ event, delayMs: i * STAGGER_MS })))
      }
      if (!finished) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // 再生中に t を依存に入れると、毎回作り直しになるため、開始時の位置だけを使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayPlaying, timeline, playback, pushFx])

  const startReplay = () => {
    if (!liveFlow) return
    setFrozen(liveFlow)
    setReplay((r) => ({ ...r, t: liveFlow.since, playing: false }))
    setMode("replay")
  }
  const endReplay = () => {
    setMode("live")
    setFrozen(null)
    setReplay((r) => ({ ...r, playing: false }))
  }

  // ---- 画面に出す値 ------------------------------------------------------------
  const summaryOf = useMemo(() => new Map(sessions.map((s) => [s.id, s] as const)), [sessions])
  const titleOf = useCallback(
    (id: string) => flow?.members.find((m) => m.id === id)?.title ?? summaryOf.get(id)?.title ?? id,
    [flow, summaryOf]
  )
  const nodes: OrgNode[] = useMemo(() => {
    if (!flow || !chart) return []
    return flow.members.map((member, i) => ({ member, state: chart.members[i], summary: summaryOf.get(member.id) ?? null }))
  }, [flow, chart, summaryOf])
  const leaderNode = nodes.find((n) => n.member.isLeader) ?? null
  // 子のカードの並び順(指揮役は常に最上段)。名前順は、01_ 02_ 03_ の順になる自然順
  const childNodes = useMemo(
    () =>
      orderMembers(
        nodes.filter((n) => !n.member.isLeader),
        memberOrder,
        (n) => n.member.title
      ),
    [nodes, memberOrder]
  )
  const lines: EventLine[] = useMemo(() => (timeline ? eventLines(timeline, viewTime, titleOf, LOG_LIMIT) : []), [timeline, viewTime, titleOf])
  const markTimes = useMemo(
    () => ({
      instruct: timeline?.events.filter((e) => e.kind === "instruct").map((e) => e.t) ?? [],
      report: timeline?.events.filter((e) => e.kind === "report").map((e) => e.t) ?? [],
    }),
    [timeline]
  )

  if (options.length === 0) {
    return (
      <Alert>
        <AlertTitle>グループがありません</AlertTitle>
        <AlertDescription>
          組織図は、Claude Desktopのサイドバーで作ったグループごとに表示します。グループに入っている（アーカイブされていない）セッションがありません。
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-3" data-testid="org-view" data-group-id={groupId ?? undefined}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="グループ" className="flex min-w-0 flex-wrap gap-1.5">
          {options.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={g.id === groupId}
              onClick={() => {
                // グループ・範囲を変えたら、ライブに戻す
                setStoredGroup(g.id)
                endReplay()
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                g.id === groupId ? "border-primary font-semibold shadow-[inset_0_0_0_1px_var(--primary)]" : "bg-card hover:bg-muted"
              )}
            >
              {g.name}
              <span className="ml-1 text-xs text-muted-foreground">{g.count}</span>
            </button>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="inline-flex overflow-hidden rounded-lg border" role="group" aria-label="モード">
            <button type="button" aria-pressed={mode === "live"} className={segClass(mode === "live")} onClick={endReplay}>
              ライブ
            </button>
            <button type="button" aria-pressed={mode === "replay"} className={segClass(mode === "replay")} onClick={startReplay}>
              振り返り
            </button>
          </div>
          <select
            aria-label="並び順"
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            value={memberOrder}
            onChange={(e) => setStoredOrder(e.target.value)}
          >
            {MEMBER_ORDERS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            aria-label="表示範囲"
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            value={rangeHours}
            onChange={(e) => {
              setStoredRange(Number(e.target.value))
              endReplay()
            }}
          >
            {RANGES.map((h) => (
              <option key={h} value={h}>
                直近{h}時間
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && !liveFlow && (
        <Alert variant="destructive">
          <AlertTitle>組織図のデータを取得できません</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      {!flow && !error && <p className="text-sm text-muted-foreground">読み込み中...</p>}

      {flow && chart && (
        <>
          <section aria-label="概要" className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="org-summary">
            {[
              ["org-stat-instruct", chart.counts.instructs, "指示（本）"],
              ["org-stat-report", chart.counts.reports, "報告（本）"],
              ["org-stat-end", chart.counts.ends, "報告なしで終了（件）"],
              ["org-stat-working", chart.counts.working, "作業中（件）"],
            ].map(([id, value, label]) => (
              <div key={id} className="rounded-xl border bg-card px-3 py-2">
                <b className="block text-xl leading-tight tabular-nums" data-testid={String(id)}>
                  {value}
                </b>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </section>

          <OrgChartCanvas
            groupId={groupId ?? undefined}
            leader={leaderNode}
            members={childNodes}
            leaderStats={{ instructs: chart.counts.instructs, reports: chart.counts.reports, working: chart.counts.working }}
            highContextRatio={highContextRatio}
            referenceTime={viewTime}
            animate={animate}
            fx={fx}
            onSelect={onSelect}
            notice={
              flow.leaderId === null ? (
                <Alert className="mb-3" data-testid="org-no-leader">
                  <AlertTitle>指揮役のセッションが見つかりません</AlertTitle>
                  <AlertDescription>
                    このグループには、タイトルが「{flow.prefix}」で始まるセッションがありません。カードだけを並べ、線は引きません。
                    接頭辞は <code className="font-mono">config/desktop-sessions.json</code> の{" "}
                    <code className="font-mono">orchestratorPrefix</code> で変えられます。
                  </AlertDescription>
                </Alert>
              ) : undefined
            }
          />

          {mode === "replay" ? (
            <OrgReplayControls
              since={flow.since}
              until={flow.generatedAt}
              t={replay.t}
              playing={replay.playing}
              speed={replay.speed}
              skipIdle={replay.skipIdle}
              marks={markTimes}
              onTogglePlay={() =>
                setReplay((r) => ({ ...r, t: !r.playing && r.t >= flow.generatedAt ? flow.since : r.t, playing: !r.playing }))
              }
              onSeek={(t) => {
                prevCtx.current = null
                setReplay((r) => ({ ...r, t }))
              }}
              onSpeed={(speed) => setReplay((r) => ({ ...r, speed }))}
              onSkipIdle={(skipIdle) => setReplay((r) => ({ ...r, skipIdle }))}
            />
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="org-live-note">
              ライブ：新しく起きた出来事だけを流します（{formatJstTime(flow.generatedAt)} 時点。5秒ごとに更新）。
              {lines.length === 0 ? "この範囲に出来事はありません。" : ""}
            </p>
          )}

          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <section className="min-w-0 space-y-1 rounded-xl border bg-card p-3" aria-label="出来事">
              <h2 className="text-sm font-medium">
                出来事
                {chart.counts.instructs + chart.counts.reports + chart.counts.ends > lines.length && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">新しい{LOG_LIMIT}件を表示</span>
                )}
              </h2>
              <ul className="max-h-56 space-y-0 overflow-y-auto text-xs" data-testid="org-log">
                {lines.length === 0 && <li className="py-1 text-muted-foreground">出来事はありません。</li>}
                {lines.map((line, i) => (
                  <li key={`${line.t}-${i}`} className="flex min-w-0 gap-2 border-b py-1 last:border-b-0" data-kind={line.label}>
                    <time className="shrink-0 tabular-nums text-muted-foreground">{formatJstTime(line.t)}</time>
                    <span
                      className="shrink-0 font-semibold"
                      style={{ color: line.tone === "down" ? "var(--flow-down-text)" : line.tone === "up" ? "var(--flow-up-text)" : line.tone === "cross" ? "var(--flow-cross-text)" : undefined }}
                    >
                      {line.label}
                    </span>
                    <span className="min-w-0 truncate" title={line.text}>
                      {line.text}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-1.5 rounded-xl border bg-card p-3 text-xs" aria-label="見方" data-testid="org-legend">
              <h2 className="text-sm font-medium">見方</h2>
              <Legend color="var(--flow-down)" line="solid">
                指示（指揮役から下へ）。線の横に先頭20文字。破線の粒は、受信を確認できていない指示
              </Legend>
              <Legend color="var(--flow-up)" line="solid">
                報告（下から指揮役へ）。粒の大きさ＝作業量（ツール呼び出し回数。82回で最大）
              </Legend>
              <Legend color="var(--flow-cross)" line="dotted">
                他のグループ・外部（CLI）から指揮役への連絡（点線）
              </Legend>
              <Legend color="var(--muted-foreground)" line="none">
                灰色の「報告なしで終了」＝指示のあと、報告せずにターンが終わった
              </Legend>
              <Legend color="var(--flow-work)" line="none">
                作業中（直近1分以内にツールを呼んでいる）。脈動が速いほど手数が多い
              </Legend>
              <Legend color="var(--status-warning)" line="none">
                コンテキスト: 80%以上で黄（注意）、90%以上で赤（危険）。圧縮で下がり、増えた分は「+28K」のように示す
              </Legend>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function Legend({ color, line, children }: { color: string; line: "solid" | "dotted" | "none"; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden
        className="mt-1 inline-block h-0 w-5 shrink-0 border-t-[3px]"
        style={{ borderColor: color, borderStyle: line === "dotted" ? "dotted" : "solid", opacity: line === "none" ? 0.9 : 1 }}
      />
      <span>{children}</span>
    </div>
  )
}
