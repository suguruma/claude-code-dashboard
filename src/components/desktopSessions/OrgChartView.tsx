"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useFlow } from "@/hooks/useFlow"
import { usePersistedState } from "@/hooks/useLocalStorage"
import { recordTime, useStartupTimes } from "@/hooks/useStartupTimes"
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
  type SeenEvents,
  stateAt,
  timelineMarks,
  type EventLine,
  type FlowTimeline,
} from "@/lib/flowPlayback"
import { MEMBER_ORDERS, normalizeMemberOrder } from "@/lib/flowOrder"
import { arrangeTree } from "@/lib/flowTree"
import { FLOW_DEFAULT_RANGE_MS, type FlowResponse } from "@/lib/flowTypes"
import { cn } from "@/lib/utils"
import { formatJstTime } from "@/lib/usageFormat"
import { failureReason, orgFrameHeight, rememberOrgHeight, sectionPhase, type SectionPhase } from "@/lib/homeStartup"
import { OrgLoadingFrame } from "@/components/home/HomeLoading"
import { OrgChartCanvas, type FxInput, type FxItem, type OrgNode } from "./OrgChartCanvas"
import { OrgReplayControls } from "./OrgReplayControls"

const GROUP_STORAGE_KEY = "ccd:org-chart:group"
const RANGE_STORAGE_KEY = "ccd:org-chart:range"
const ORDER_STORAGE_KEY = "ccd:org-chart:order"
/** 組織図の高さ(グループ・範囲ごと。数だけ)。読み込み中の枠を前回と同じ高さにする(⑫ ST-6) */
const HEIGHT_STORAGE_KEY = "ccd:org-chart:heights"
/** 高さを覚え直すのは、前と比べてこれ以上変わったときだけ(px) */
const HEIGHT_REMEMBER_STEP = 8
const HOUR_MS = 60 * 60 * 1000
const RANGES = [1, 4, 24] as const
const LOG_LIMIT = 50
/** 同時に起きた出来事の粒を、少しずつずらして流す間隔(ms) */
const STAGGER_MS = 250
const COMMIT_MS = 100

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)"

/**
 * 組織図の読み込み中の枠の高さ(一覧が来る前のホームで使う)。グループはまだ分からないので、前回選んだグループ・範囲の高さを使う
 */
export function useOrgFrameHeightBeforeList(): number {
  const [storedGroup] = usePersistedState<string>(GROUP_STORAGE_KEY, "")
  const [storedRange] = usePersistedState<number>(RANGE_STORAGE_KEY, 4)
  const [savedHeights] = usePersistedState<Record<string, number>>(HEIGHT_STORAGE_KEY, {})
  const rangeHours = (RANGES as readonly number[]).includes(storedRange) ? storedRange : FLOW_DEFAULT_RANGE_MS / HOUR_MS
  return orgFrameHeight(savedHeights, storedGroup || null, rangeHours)
}

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
  /**
   * いまの組織図にカードとして出ているセッションのID(ライブのデータで決める)。組織図のデータがまだ無い・取れないときは null。
   * failed は、組織図のデータを取れなかったとき true。ホームの「組織図に出ていないセッション」に使う(⑧)
   */
  onShownChange?: (memberIds: string[] | null, failed: boolean) => void
  /** 組織図の欄の状態(⑫ ST-9 の印に使う) */
  onPhaseChange?: (phase: SectionPhase) => void
}

/** 組織図の表示(グループ別の指揮役と子のカード、指示・報告の信号、ライブと振り返り) */
export function OrgChartView({ sessions, groups, highContextRatio, onSelect, onShownChange, onPhaseChange }: OrgChartViewProps) {
  const [storedGroup, setStoredGroup] = usePersistedState<string>(GROUP_STORAGE_KEY, "")
  const [storedRange, setStoredRange] = usePersistedState<number>(RANGE_STORAGE_KEY, 4)
  const [storedOrder, setStoredOrder] = usePersistedState<string>(ORDER_STORAGE_KEY, "name")
  const memberOrder = normalizeMemberOrder(storedOrder)
  const options = useMemo(() => visibleGroups(groups, sessions, false, storedGroup), [groups, sessions, storedGroup])
  const groupId = options.find((g) => g.id === storedGroup)?.id ?? options[0]?.id ?? null
  const rangeHours = (RANGES as readonly number[]).includes(storedRange) ? storedRange : FLOW_DEFAULT_RANGE_MS / HOUR_MS
  const rangeMs = rangeHours * HOUR_MS

  const { data: liveFlow, error, retry: retryFlow } = useFlow(groupId, rangeMs)
  // カードとして出ているセッションを知らせる。グループが無ければ空、別のグループのデータが残っている間は「まだ分からない」
  const shownKey = groupId === null ? "" : liveFlow && liveFlow.group.id === groupId ? liveFlow.members.map((m) => m.id).join(",") : null
  const shownFailed = shownKey === null && error !== undefined && error !== null
  useEffect(() => {
    if (!onShownChange) return
    onShownChange(shownKey === null ? null : shownKey === "" ? [] : shownKey.split(","), shownFailed)
  }, [shownKey, shownFailed, onShownChange])
  const reducedMotion = usePrefersReducedMotion()
  const animate = shouldAnimate(reducedMotion)
  const now = useNow(1_000)

  // ---- 読み込みの状態(⑫ ST-8)。時間で打ち切らず、30秒たったら案内を出す。数え始めは、グループ・範囲を変えたとき・出し直したとき
  const loadTimeKey = `home:org:${groupId}|${rangeMs}`
  const times = useStartupTimes()
  useEffect(() => {
    recordTime(loadTimeKey, true)
  }, [loadTimeKey])
  const phase = sectionPhase({
    hasData: liveFlow !== null,
    failed: Boolean(error) && liveFlow === null,
    startedAt: times[loadTimeKey] ?? now,
    now,
  })
  useEffect(() => {
    onPhaseChange?.(phase)
  }, [phase, onPhaseChange])
  const retry = useCallback(() => {
    recordTime(loadTimeKey, true)
    return retryFlow()
  }, [retryFlow, loadTimeKey])

  // ---- 組織図の高さを覚える(読み込み中の枠を前回と同じ高さにする)
  const [savedHeights, setSavedHeights] = usePersistedState<Record<string, number>>(HEIGHT_STORAGE_KEY, {})
  const frameHeight = orgFrameHeight(savedHeights, groupId, rangeHours)
  const bodyRef = useRef<HTMLDivElement | null>(null)

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
  const seen = useRef<{ key: string; keys: SeenEvents }>({ key: "", keys: new Map() })
  useEffect(() => {
    if (mode !== "live" || !liveFlow) {
      seen.current = { key: "", keys: new Map() }
      return
    }
    const key = `${liveFlow.group.id}|${rangeMs}`
    if (seen.current.key !== key) {
      // 最初の表示(開いた直後・グループや範囲を変えた直後): 過去の出来事は流さず、全件を見たことにする
      seen.current = { key, keys: new Map() }
      selectUnseen(liveFlow.events, seen.current.keys)
      return
    }
    const { fresh, upgraded } = selectUnseen(liveFlow.events, seen.current.keys)
    // 「受信未確認」で流した指示が確認済みになったときは、粒をもう一度流さず、表示中の印だけを切り替える
    pushFx([
      ...upgraded.map((e) => ({ delayMs: 0, receiptConfirmed: { to: e.to, summary: e.summary } })),
      ...fresh.map((event, i) => ({ event, delayMs: i * STAGGER_MS })),
    ])
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
  // 子のカードの並び順(指揮役は常に最上段)。名前順は、01_ 02_ 03_ の順になる自然順。
  // 2層目(指揮役の子)と、親ごとの3層目に、同じ規則を適用する
  const { children: childNodes, subs: subNodes } = useMemo(
    () => arrangeTree(nodes, { leaderId: flow?.leaderId ?? null, order: memberOrder }),
    [nodes, memberOrder, flow?.leaderId]
  )
  const lines: EventLine[] = useMemo(() => (timeline ? eventLines(timeline, viewTime, titleOf, LOG_LIMIT) : []), [timeline, viewTime, titleOf])
  const markTimes = useMemo(
    () => ({
      instruct: timeline?.events.filter((e) => e.kind === "instruct").map((e) => e.t) ?? [],
      report: timeline?.events.filter((e) => e.kind === "report").map((e) => e.t) ?? [],
    }),
    [timeline]
  )

  // 組織図が出たら、その高さ(4つの数字から下の枠まで)を覚える。次に開いたときの読み込み中の枠に使う
  const hasBody = Boolean(flow && chart)
  useEffect(() => {
    const el = bodyRef.current
    if (!hasBody || !el || !groupId || mode !== "live") return
    const height = el.getBoundingClientRect().height
    if (height <= 0 || Math.abs(height - frameHeight) < HEIGHT_REMEMBER_STEP) return
    setSavedHeights(rememberOrgHeight(savedHeights, groupId, rangeHours, height))
  }, [hasBody, groupId, rangeHours, mode, frameHeight, savedHeights, setSavedHeights, nodes.length])

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

      {/* 読み込み中・時間がかかる・失敗は、読み込み後と同じ並びの枠の中に出す(⑫ ST-6・ST-8) */}
      {!flow && (
        <OrgLoadingFrame
          height={frameHeight}
          state={phase === "failed" ? "failed" : phase === "slow" ? "slow" : "loading"}
          reason={phase === "failed" ? failureReason(error) : undefined}
          onRetry={retry}
        />
      )}

      {flow && chart && (
        <div ref={bodyRef} className="space-y-3" data-testid="org-body">
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
            subs={subNodes}
            leaderStats={{ instructs: chart.counts.leaderInstructs, reports: chart.counts.leaderReports, working: chart.counts.working }}
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
                    このグループには、タイトルが「{flow.prefix}」で始まるセッションがありません。カードだけを並べ、線は引きません（3層目も出しません）。
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

          {/*
            出来事と見方は、広い幅(lg 以上)では半分ずつ横に並べ、狭い幅では上下に並べる(オーナーの依頼。10/19)。
            2つの枠は同じ高さにそろえる。出来事の一覧は 16rem を基本にし、見方のほうが高いときだけ、その高さまで伸びる
            (はみ出す分は中でスクロール)。見方の文は短くして、出来事と同じくらいの高さに収める(詳しい説明は使い方ガイド)。
            見方の文が長いと、出来事が約500pxまで伸びて長すぎた。一覧の伸び方は grow と basis-0(0px)にする。flex-1(basis 0%)だと、
            高さの決まらない枠では中身の高さ(全件分)として計算され、一覧が全件の高さまで伸びるため。見方の項目は、枠の幅に合わせて1・2・4列に並べる
          */}
          <div className="grid gap-3 lg:grid-cols-2" data-testid="org-below">
            <section className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3" aria-label="出来事">
              <h2 className="text-sm font-medium">
                出来事
                {chart.counts.instructs + chart.counts.reports + chart.counts.ends > lines.length && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">新しい{LOG_LIMIT}件を表示</span>
                )}
              </h2>
              <ul className="max-h-64 space-y-0 overflow-y-auto text-xs lg:max-h-none lg:min-h-64 lg:grow lg:basis-0" data-testid="org-log">
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

            <section className="@container min-w-0 space-y-1.5 rounded-xl border bg-card p-3 text-xs" aria-label="見方" data-testid="org-legend">
              <h2 className="text-sm font-medium">見方</h2>
              <div className="grid gap-x-6 gap-y-1.5 @sm:grid-cols-2 @4xl:grid-cols-4">
                <Legend color="var(--flow-down)" line="solid">
                  指示（指揮役から下へ）。線の横に先頭20文字。破線の粒＝受信を確認できていない
                </Legend>
                <Legend color="var(--flow-up)" line="solid">
                  報告（下から指揮役へ）。粒が大きいほど作業量が多い（100回で最大）
                </Legend>
                <Legend color="var(--muted-foreground)" line="none">
                  3層目: 子が作った補助のセッション。子のカードの下に字下げして並べる
                </Legend>
                <Legend color="var(--flow-cross)" line="dotted">
                  他のグループ・外部（CLI）からの連絡（点線）
                </Legend>
                <Legend color="var(--muted-foreground)" line="none">
                  灰色の「報告なしで終了」＝報告せずにターンが終わった
                </Legend>
                <Legend color="var(--flow-work)" line="none">
                  作業中＝直近1分にツールを呼んだ。脈動が速いほど手数が多い
                </Legend>
                <Legend color="var(--work-lap-1)" line="none">
                  作業量のバー＝ツール呼び出しの回数。100回で1周し、次の周は濃い色（「2周目」など）。警告ではない
                </Legend>
                <Legend color="var(--status-warning)" line="none">
                  コンテキスト: 80%以上で黄、90%以上で赤。増えた分は「+28K」
                </Legend>
              </div>
            </section>
          </div>
        </div>
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
