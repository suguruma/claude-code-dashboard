"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useFlow } from "@/hooks/useFlow"
import { usePersistedState } from "@/hooks/useLocalStorage"
import { recordTime, useStartupTimes } from "@/hooks/useStartupTimes"
import { visibleGroups } from "@/lib/desktopSessionFilters"
import type { DesktopSessionGroup, DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import {
  buildTimeline,
  eventLines,
  formatCtxDelta,
  selectUnseen,
  shouldAnimate,
  type SeenEvents,
  stateAt,
  type EventLine,
  type FlowTimeline,
} from "@/lib/flowPlayback"
import { arrangeTree } from "@/lib/flowTree"
import { FLOW_DEFAULT_RANGE_MS } from "@/lib/flowTypes"
import { cn } from "@/lib/utils"
import { formatJstTime } from "@/lib/usageFormat"
import { failureReason, orgFrameHeight, rememberOrgHeight, sectionPhase, type SectionPhase } from "@/lib/homeStartup"
import { OrgLoadingFrame } from "@/components/home/HomeLoading"
import { CloudSessionsLink } from "./CloudSessionsLink"
import { OrgChartCanvas, type FxInput, type FxItem, type OrgNode } from "./OrgChartCanvas"

const GROUP_STORAGE_KEY = "ccd:org-chart:group"
/** 組織図の高さ(グループ・範囲ごと。数だけ)。読み込み中の枠を前回と同じ高さにする(⑫ ST-6) */
const HEIGHT_STORAGE_KEY = "ccd:org-chart:heights"
/** 高さを覚え直すのは、前と比べてこれ以上変わったときだけ(px) */
const HEIGHT_REMEMBER_STEP = 8
/**
 * 表示範囲は直近4時間、カードは作成順に決めた(⑬ の棚卸しの行52。期間と並び順の選択はやめた)。
 * 高さの記録は範囲ごとの形のまま使う
 */
const RANGE_MS = FLOW_DEFAULT_RANGE_MS
const RANGE_HOURS = RANGE_MS / (60 * 60 * 1000)
const LOG_LIMIT = 50
/** 同時に起きた出来事の粒を、少しずつずらして流す間隔(ms) */
const STAGGER_MS = 250

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)"

/**
 * 組織図の読み込み中の枠の高さ(一覧が来る前のホームで使う)。グループはまだ分からないので、前回選んだグループの高さを使う
 */
export function useOrgFrameHeightBeforeList(): number {
  const [storedGroup] = usePersistedState<string>(GROUP_STORAGE_KEY, "")
  const [savedHeights] = usePersistedState<Record<string, number>>(HEIGHT_STORAGE_KEY, {})
  return orgFrameHeight(savedHeights, storedGroup || null, RANGE_HOURS)
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

/** 組織図の表示(グループ別の指揮役と子のカード、指示・報告の信号。ライブだけ) */
export function OrgChartView({ sessions, groups, highContextRatio, onSelect, onShownChange, onPhaseChange }: OrgChartViewProps) {
  const [storedGroup, setStoredGroup] = usePersistedState<string>(GROUP_STORAGE_KEY, "")
  const options = useMemo(() => visibleGroups(groups, sessions, false, storedGroup), [groups, sessions, storedGroup])
  const groupId = options.find((g) => g.id === storedGroup)?.id ?? options[0]?.id ?? null

  const { data: flow, error, retry: retryFlow } = useFlow(groupId, RANGE_MS)
  // カードとして出ているセッションを知らせる。グループが無ければ空、別のグループのデータが残っている間は「まだ分からない」
  const shownKey = groupId === null ? "" : flow && flow.group.id === groupId ? flow.members.map((m) => m.id).join(",") : null
  const shownFailed = shownKey === null && error !== undefined && error !== null
  useEffect(() => {
    if (!onShownChange) return
    onShownChange(shownKey === null ? null : shownKey === "" ? [] : shownKey.split(","), shownFailed)
  }, [shownKey, shownFailed, onShownChange])
  const reducedMotion = usePrefersReducedMotion()
  const animate = shouldAnimate(reducedMotion)
  const now = useNow(1_000)

  // ---- 読み込みの状態(⑫ ST-8)。時間で打ち切らず、30秒たったら案内を出す。数え始めは、グループを変えたとき・出し直したとき
  const loadTimeKey = `home:org:${groupId}|${RANGE_MS}`
  const times = useStartupTimes()
  useEffect(() => {
    recordTime(loadTimeKey, true)
  }, [loadTimeKey])
  const phase = sectionPhase({
    hasData: flow !== null,
    failed: Boolean(error) && flow === null,
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
  const frameHeight = orgFrameHeight(savedHeights, groupId, RANGE_HOURS)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const timeline = useMemo<FlowTimeline | null>(() => (flow ? buildTimeline(flow) : null), [flow])

  // ---- 効果(粒・強調)の待ち行列 ---------------------------------------------
  const [fx, setFx] = useState<FxItem[]>([])
  const fxSeq = useRef(0)
  const pushFx = useCallback((items: FxInput[]) => {
    if (items.length === 0) return
    setFx((prev) => [...prev, ...items.map((item) => ({ ...item, id: ++fxSeq.current }))].slice(-60))
  }, [])

  // ---- 新しい出来事だけを流す ---------------------------------------------------
  const seen = useRef<{ key: string; keys: SeenEvents }>({ key: "", keys: new Map() })
  useEffect(() => {
    if (!flow) {
      seen.current = { key: "", keys: new Map() }
      return
    }
    const key = flow.group.id
    if (seen.current.key !== key) {
      // 最初の表示(開いた直後・グループを変えた直後): 過去の出来事は流さず、全件を見たことにする
      seen.current = { key, keys: new Map() }
      selectUnseen(flow.events, seen.current.keys)
      return
    }
    const { fresh, upgraded } = selectUnseen(flow.events, seen.current.keys)
    // 「受信未確認」で流した指示が確認済みになったときは、粒をもう一度流さず、表示中の印だけを切り替える
    pushFx([
      ...upgraded.map((e) => ({ delayMs: 0, receiptConfirmed: { to: e.to, summary: e.summary } })),
      ...fresh.map((event, i) => ({ event, delayMs: i * STAGGER_MS })),
    ])
  }, [flow, pushFx])

  // ---- 表示する状態 ------------------------------------------------------------
  const chart = useMemo(() => (timeline ? stateAt(timeline, now) : null), [timeline, now])

  // コンテキストの増えた分(「+28K」)の強調
  const prevCtx = useRef<{ key: string; ctx: Map<string, number | null> } | null>(null)
  useEffect(() => {
    if (!chart || !flow) return
    const previous = prevCtx.current
    const next = new Map(chart.members.map((m) => [m.id, m.ctx] as const))
    prevCtx.current = { key: flow.group.id, ctx: next }
    if (!previous || previous.key !== prevCtx.current.key) return
    const items: FxInput[] = []
    for (const m of chart.members) {
      const before = previous.ctx.get(m.id)
      if (before == null || m.ctx === null) continue
      const text = formatCtxDelta(m.ctx - before)
      if (text) items.push({ delayMs: 0, delta: { sid: m.id, text } })
    }
    pushFx(items)
  }, [chart, flow, pushFx])

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
  // 子のカードは作成順(指揮役は常に最上段)。2層目(指揮役の子)と、親ごとの3層目に、同じ規則を適用する
  const { children: childNodes, subs: subNodes } = useMemo(
    () => arrangeTree(nodes, { leaderId: flow?.leaderId ?? null, order: "created" }),
    [nodes, flow?.leaderId]
  )
  const lines: EventLine[] = useMemo(() => (timeline ? eventLines(timeline, now, titleOf, LOG_LIMIT) : []), [timeline, now, titleOf])

  // 組織図が出たら、その高さを覚える。次に開いたときの読み込み中の枠に使う
  const hasBody = Boolean(flow && chart)
  useEffect(() => {
    const el = bodyRef.current
    if (!hasBody || !el || !groupId) return
    const height = el.getBoundingClientRect().height
    if (height <= 0 || Math.abs(height - frameHeight) < HEIGHT_REMEMBER_STEP) return
    setSavedHeights(rememberOrgHeight(savedHeights, groupId, RANGE_HOURS, height))
  }, [hasBody, groupId, frameHeight, savedHeights, setSavedHeights, nodes.length])

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
      <nav aria-label="グループ" className="flex min-w-0 flex-wrap gap-1.5">
        {options.map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={g.id === groupId}
            onClick={() => setStoredGroup(g.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              g.id === groupId ? "border-primary font-semibold shadow-[inset_0_0_0_1px_var(--primary)]" : "bg-card hover:bg-muted"
            )}
          >
            {g.name}
            <span className="ml-1 text-xs text-muted-foreground">{g.count}</span>
          </button>
        ))}
        {/* クラウドのセッションは中身を出せないので、claude.ai を開くボタンだけ(⑬ CL-1) */}
        <CloudSessionsLink />
      </nav>

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
          <OrgChartCanvas
            groupId={groupId ?? undefined}
            leader={leaderNode}
            members={childNodes}
            subs={subNodes}
            leaderStats={{ instructs: chart.counts.leaderInstructs, reports: chart.counts.leaderReports, working: chart.counts.working }}
            highContextRatio={highContextRatio}
            referenceTime={now}
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

          <p className="text-xs text-muted-foreground" data-testid="org-live-note">
            直近4時間・カードは作成順。新しく起きた出来事だけを流します（{formatJstTime(flow.generatedAt)} 時点。5秒ごとに更新）。
            {lines.length === 0 ? "この範囲に出来事はありません。" : ""}
          </p>

          {/* 出来事の一覧は、初めは閉じておく(⑬ の棚卸しの行6。見方の7行は行54でやめた) */}
          <details className="group rounded-xl border bg-card p-3" data-testid="org-events">
            <summary className="cursor-pointer text-sm font-medium">
              出来事 <span className="font-normal text-muted-foreground">{lines.length}件</span>
              {chart.counts.instructs + chart.counts.reports + chart.counts.ends > lines.length && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">新しい{LOG_LIMIT}件を表示</span>
              )}
            </summary>
            <ul className="mt-2 max-h-64 space-y-0 overflow-y-auto text-xs" data-testid="org-log">
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
          </details>
        </div>
      )}
    </div>
  )
}
