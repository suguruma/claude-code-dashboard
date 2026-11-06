"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { StatusMarkBadge } from "@/components/desktopSessions/statusMeta"
import { useInbox } from "@/hooks/useInbox"
import { useMonitorPlan } from "@/hooks/useMonitor"
import type { DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import { agoText, cardAnchor } from "@/lib/inbox"
import { redactPathsInText } from "@/lib/lanAccess/redact"
import { PLAN_STATE_LABEL, type PlanItem } from "@/lib/monitor/monitorTypes"
import { buildBoard, holdOrder, type BoardColumn } from "@/lib/sessionBoard"
import { buildMarks, quietMark, type MarkTone, type StatusMark } from "@/lib/statusMark"
import { cn } from "@/lib/utils"

/** カードの左の帯の色(印と同じ意味。要件メモ 4-2 の色の意味表) */
const TONE_BORDER: Record<MarkTone, string> = {
  red: "border-l-[var(--status-critical)]",
  amber: "border-l-[var(--status-warning)]",
  green: "border-l-[var(--status-good)]",
  blue: "border-l-[var(--status-info)]",
  gray: "border-l-muted-foreground/50",
}

const COLUMN_HEAD: Record<Exclude<BoardColumn, "stopped">, { title: string; mark: StatusMark; empty: string }> = {
  decision: { title: "次にやる判断", mark: { symbol: "？", text: "", tone: "red", estimated: false, decision: true }, empty: "判断を待っているセッションはありません" },
  running: { title: "作業中", mark: { symbol: "◌", text: "", tone: "blue", estimated: false, decision: false }, empty: "作業中のセッションはありません" },
  done: { title: "完了（未読と24時間）", mark: { symbol: "●", text: "", tone: "green", estimated: false, decision: false }, empty: "直近24時間に終わったセッションはありません" },
  quiet: { title: "静か", mark: { symbol: "－", text: "", tone: "gray", estimated: false, decision: false }, empty: "24時間より前のセッションはありません" },
}

/**
 * セッション一覧の看板(⑮ OR-3)。4列：次にやる判断・作業中(下に「止まったかもしれない」)・完了(未読と24時間)・静か(24時間より前)。
 * カードは題名・状態の印・グループ・経過・抜粋1行と、作業計画が読めるときだけ「今：<作業>［段階］」。押すと詳細。
 * 並びは 急ぐ順 → 新しい順 で決まり、押している間・ポインタが看板の上にある間は入れ替えない(A13)。
 * 鐘から #card-<ID> で来たときは、そのカードへ送り、枠で目立たせる。幅が足りないときは3列にし、静かは1行にする。
 */
export function SessionBoard({ sessions, generatedAt, onSelect }: { sessions: DesktopSessionSummary[]; generatedAt: number; onSelect: (id: string) => void }) {
  const inbox = useInbox()
  const unreadAt = inbox.unreadAt
  // 看板を開いたら「見た」(指示56 案1)。画面は見る前の基準のままにし、離れていた間に終わった物を未読で出す
  const seen = useRef(false)
  const { baseReady, see } = inbox
  useEffect(() => {
    if (!baseReady || seen.current) return
    seen.current = true
    // 記録がまだ読めていなければ、次に see が替わったとき(読めたとき)にもう一度
    void see(true).then((ok) => {
      if (!ok) seen.current = false
    })
  }, [baseReady, see])
  const plan = useMonitorPlan(true)
  const marks = useMemo(() => buildMarks(sessions, generatedAt), [sessions, generatedAt])
  const board = useMemo(
    () =>
      buildBoard(
        sessions,
        marks,
        (s) => s.lastActivityAt !== null && unreadAt(s.id, "turn-end", s.lastActivityAt),
        generatedAt
      ),
    [sessions, marks, unreadAt, generatedAt]
  )
  const planBySession = useMemo(() => {
    const m = new Map<string, PlanItem>()
    for (const g of plan.data?.plan.groups ?? []) for (const it of g.items) if (!m.has(it.sessionId)) m.set(it.sessionId, it)
    return m
  }, [plan.data])

  // A13：ポインタが看板の上にある間・押している間は、入ったときの並びを保つ(消えた物は除き、新しい物は最後)
  const [frozen, setFrozen] = useState<Record<BoardColumn, string[]> | null>(null)
  const shown = useMemo(() => {
    const out = {} as Record<BoardColumn, DesktopSessionSummary[]>
    for (const c of Object.keys(board) as BoardColumn[]) out[c] = frozen ? holdOrder(frozen[c], board[c]) : board[c]
    return out
  }, [board, frozen])
  const freeze = () => {
    if (frozen) return
    const ids = {} as Record<BoardColumn, string[]>
    for (const c of Object.keys(board) as BoardColumn[]) ids[c] = board[c].map((x) => x.id)
    setFrozen(ids)
  }

  // 鐘から来たカード(#card-<ID>)へ送って目立たせる
  const [focusId, setFocusId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      const m = /^#card-(.+)$/.exec(window.location.hash)
      if (!m) return
      const id = decodeURIComponent(m[1])
      setFocusId(id)
      window.setTimeout(() => document.getElementById(cardAnchor(id))?.scrollIntoView({ block: "center" }), 50)
    }
    read()
    window.addEventListener("hashchange", read)
    return () => window.removeEventListener("hashchange", read)
  }, [])

  const [showQuiet, setShowQuiet] = useState(false)
  const card = (s: DesktopSessionSummary, column: BoardColumn) => {
    const base = marks.get(s.id)
    if (!base) return null
    const mark = column === "quiet" ? quietMark(base) : base
    const unread = column === "done" && s.lastActivityAt !== null && inbox.unreadAt(s.id, "turn-end", s.lastActivityAt)
    return (
      <BoardCard
        key={s.id}
        session={s}
        mark={mark}
        unread={unread}
        plan={planBySession.get(s.id) ?? null}
        ago={s.lastActivityAt === null ? null : agoText(generatedAt - s.lastActivityAt)}
        focused={focusId === s.id}
        onSelect={onSelect}
      />
    )
  }

  const quietCount = shown.quiet.length
  return (
    <div
      className="@container"
      data-testid="session-board"
      onPointerEnter={freeze}
      onPointerLeave={() => setFrozen(null)}
      onFocus={freeze}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFrozen(null)
      }}
    >
      {/* 狭いとき(3列)：静かは列の上に1行 */}
      <p className="mb-2 text-sm text-muted-foreground @[60rem]:hidden" data-testid="board-quiet-line">
        静か {quietCount}
        {quietCount === 0 ? "（24時間より前のセッションはありません）" : "（24時間より前に動いた、見たセッション）"}
        {quietCount > 0 && (
          <button type="button" className="ml-2 text-primary hover:underline" onClick={() => setShowQuiet((v) => !v)}>
            {showQuiet ? "たたむ" : `${quietCount}件を出す`}
          </button>
        )}
      </p>
      <div className="grid grid-cols-3 items-start gap-3 @[60rem]:grid-cols-[1.15fr_1fr_1fr_minmax(10rem,0.7fr)]">
        <Column id="decision" count={shown.decision.length}>
          {shown.decision.map((s) => card(s, "decision"))}
        </Column>
        <Column id="running" count={shown.running.length}>
          {shown.running.map((s) => card(s, "running"))}
          <div className="flex items-center gap-2 border-t px-3 py-1.5 text-sm text-muted-foreground" data-testid="board-stopped-head">
            <StatusMarkBadge mark={{ symbol: "‖", text: "止まったかもしれない", tone: "amber", estimated: false, decision: false }} />
            {shown.stopped.length}
          </div>
          {shown.stopped.map((s) => card(s, "stopped"))}
        </Column>
        <Column id="done" count={shown.done.length}>
          {shown.done.map((s) => card(s, "done"))}
        </Column>
        <Column id="quiet" count={quietCount} className="hidden @[60rem]:block">
          {quietCount > 0 && (
            <button type="button" className="w-full px-3 py-2 text-left text-sm text-primary hover:underline" onClick={() => setShowQuiet((v) => !v)}>
              {showQuiet ? "たたむ" : `${quietCount}件を出す`}
            </button>
          )}
          {showQuiet && shown.quiet.map((s) => card(s, "quiet"))}
        </Column>
      </div>
      {showQuiet && quietCount > 0 && (
        <div className="mt-3 space-y-0 rounded-xl bg-muted/40 ring-1 ring-foreground/10 @[60rem]:hidden">{shown.quiet.map((s) => card(s, "quiet"))}</div>
      )}
    </div>
  )
}

function Column({ id, count, className, children }: { id: Exclude<BoardColumn, "stopped">; count: number; className?: string; children: React.ReactNode }) {
  const head = COLUMN_HEAD[id]
  const empty = count === 0 && id !== "running"
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-xl bg-muted/40 ring-1 ring-foreground/10", className)} aria-label={`${head.title} ${count}件`} data-testid={`board-col-${id}`}>
      <h2 className="flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold">
        <StatusMarkBadge mark={head.mark} compact />
        {head.title} {count}
      </h2>
      {empty ? <p className="px-3 py-2 text-sm text-muted-foreground">{head.empty}</p> : children}
      {id === "running" && count === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">{head.empty}</p>}
    </section>
  )
}

function BoardCard({
  session: s,
  mark,
  unread,
  plan,
  ago,
  focused,
  onSelect,
}: {
  session: DesktopSessionSummary
  mark: StatusMark
  unread: boolean
  plan: PlanItem | null
  ago: string | null
  focused: boolean
  onSelect: (id: string) => void
}) {
  // 抜粋は伏せてある(サーバーの側)。作業フォルダのパスは最後の名前にする(要件メモ 15 の 3.)
  const raw = s.needsActionExcerpt ?? s.latestInstruction?.excerpt ?? null
  const excerpt = raw === null ? null : redactPathsInText(raw)
  // 題名の無いセッションは、題名の代わりに指示の抜粋が入るので、題名もパスを隠す
  const title = redactPathsInText(s.title)
  return (
    <button
      type="button"
      id={cardAnchor(s.id)}
      onClick={() => onSelect(s.id)}
      className={cn(
        "m-1.5 block w-[calc(100%-0.75rem)] rounded-lg border border-l-4 bg-card px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        TONE_BORDER[mark.tone],
        focused && "ring-2 ring-[var(--status-info)]"
      )}
      data-testid="board-card"
      data-unread={unread ? "true" : "false"}
    >
      <span className={cn("block truncate font-semibold", unread && "font-bold")} title={title}>
        {unread && <span className="mr-1 text-[var(--status-info-text)]">● 未読</span>}
        {title}
      </span>
      <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
        <StatusMarkBadge mark={mark} />
        <span className="truncate">
          {s.group?.name ?? "グループ外"}
          {ago && `・${ago}`}
        </span>
      </span>
      {excerpt && <span className="mt-1 block truncate">{excerpt}</span>}
      {plan && (
        <span className="mt-1 block truncate" data-testid="board-now">
          今：{redactPathsInText(plan.task)}［{PLAN_STATE_LABEL[plan.state]}］
        </span>
      )}
    </button>
  )
}
