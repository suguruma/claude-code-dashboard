"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import { OpenSessionButton } from "@/components/desktopSessions/Messaging"
import { usePersistedState } from "@/hooks/useLocalStorage"
import type { DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import type { SectionPhase } from "@/lib/homeStartup"
import {
  URGENCY_LABEL,
  buildNextDecisions,
  countByUrgency,
  countRest,
  countsText,
  formatWait,
  hiddenText,
  interruptedText,
  restText,
  splitPreview,
  type NextDecision,
  type Urgency,
} from "@/lib/nextDecisions"
import { cn } from "@/lib/utils"
import { RetryNotice, Skeleton } from "./HomeLoading"

/** 骨組みの1行の高さ(読み込み中に高さを決めて、後から動かさない。A10) */
const SKELETON_ROW_HEIGHT = 102
/** 骨組みの行の数(最初に見せる最大の件数と同じ) */
const SKELETON_ROWS = 5

/** 開いているかを覚える localStorage のキー(値は JSON の true / false) */
const OPEN_STORAGE_KEY = "ccd:home-decisions-open"

/**
 * 閉じていたら、描画の前に <html data-home-decisions="closed"> を付ける(globals.css が中身を隠す)。
 * 静的な HTML の中で動き、ハイドレーションの後に閉じて画面が縮むこと(ずれ)を防ぐ。外と通信しない
 */
const CLOSED_BEFORE_PAINT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(OPEN_STORAGE_KEY)})==="false")document.documentElement.dataset.homeDecisions="closed"}catch(e){}`

const URGENCY_STYLE: Record<Urgency, { color: string; border: string }> = {
  urgent: { color: "var(--status-critical-text)", border: "var(--status-critical)" },
  today: { color: "var(--status-warning-text)", border: "var(--status-warning)" },
  anytime: { color: "var(--muted-foreground)", border: "var(--border)" },
}

interface NextDecisionsProps {
  /** セッション一覧(未取得・データなしは null) */
  sessions: DesktopSessionSummary[] | null
  /** 一覧の状態(⑫ の段階表示。ready でないあいだは骨組み、failed は取れないときの文) */
  phase: SectionPhase
  now: number
  /** 読み込めなかった理由(短い文) */
  failure?: string
  onRetry: () => Promise<unknown>
}

/**
 * 次にやる判断(⑬ ND-1〜ND-10)。ホームのいちばん上に、オーナーの判断を待つセッションを急ぐ順に1行ずつ出す。
 * 最初は最大5件(急ぎは全部)、残りは［ほか n件を出す］で開く。読み取り専用で、答えは Claude Desktop で入力する(［開く］)。
 * 見出しを押すと閉じる・開く(オーナーの指示 10/25)。閉じても、件数(急ぎ・今日中・いつでも)と読み込めなかった知らせは出す。
 */
export function NextDecisions({ sessions, phase, now, failure, onRetry }: NextDecisionsProps) {
  const [showAll, setShowAll] = useState(false)
  const [open, setOpenStored] = usePersistedState<boolean>(OPEN_STORAGE_KEY, true)
  const toggle = () => {
    const next = !open
    setOpenStored(next)
    // 描画の前に付けた印も合わせる(残すと、開いても globals.css が隠したままになる)
    if (next) delete document.documentElement.dataset.homeDecisions
    else document.documentElement.dataset.homeDecisions = "closed"
  }
  const ready = phase === "ready" && sessions !== null
  const list = useMemo(() => (ready ? buildNextDecisions(sessions, now) : []), [ready, sessions, now])
  const counts = countByUrgency(list)
  const { shown, hidden } = splitPreview(list)
  const rest = useMemo(() => (ready ? countRest(sessions) : null), [ready, sessions])
  const restLine = rest ? restText(rest) : null
  const interruptedLine = rest ? interruptedText(rest) : null

  return (
    <section
      id="home-decisions"
      aria-labelledby="home-decisions-title"
      aria-busy={!ready && phase !== "failed"}
      className="space-y-3"
      data-testid="home-decisions"
      data-phase={phase}
    >
      <script dangerouslySetInnerHTML={{ __html: CLOSED_BEFORE_PAINT_SCRIPT }} />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="home-decisions-title" className="text-lg font-semibold">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="home-decisions-body"
            onClick={toggle}
            className="inline-flex min-h-11 items-center gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="home-decisions-toggle"
          >
            <ChevronRight className={cn("size-5 transition-transform", open && "rotate-90")} aria-hidden />
            次にやる判断
          </button>
        </h2>
        {ready ? (
          <span className="text-sm text-muted-foreground" data-testid="home-decisions-count">
            {countsText(counts)}
          </span>
        ) : (
          phase !== "failed" && <Skeleton className="h-4 w-40" />
        )}
      </div>

      {phase === "failed" && <RetryNotice phase="failed" text={`次にやる判断を読み込めませんでした${failure ? `（${failure}）` : ""}。`} onRetry={onRetry} />}

      <div id="home-decisions-body" hidden={!open} className="space-y-3" data-testid="home-decisions-body">
        {!ready && phase !== "failed" && (
          <div className="space-y-2" aria-hidden>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <Skeleton key={i} className="w-full rounded-lg" style={{ height: SKELETON_ROW_HEIGHT }} />
            ))}
            {phase === "slow" && <RetryNotice phase="slow" text="次にやる判断の読み込みに時間がかかっています（30秒以上）。このまま待てます。" onRetry={onRetry} />}
          </div>
        )}
        {ready && list.length === 0 && <p className="text-sm">いま決めることはありません。</p>}
        {ready && list.length > 0 && (
          <ol className="space-y-2" data-testid="home-decisions-list">
            {(showAll ? list : shown).map((d) => (
              <DecisionRow key={d.id} d={d} />
            ))}
          </ol>
        )}
        {ready && hidden.length > 0 && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="rounded-md border px-3 py-1.5 text-sm hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            data-testid="home-decisions-more"
          >
            {hiddenText(hidden)}
          </button>
        )}

        {ready && (restLine || interruptedLine) && (
          <div className="space-y-0.5 border-t pt-2 text-sm text-muted-foreground" data-testid="home-rest">
            {restLine && <p>{restLine}（組織図とセッション一覧で見る）</p>}
            {interruptedLine && <p>{interruptedLine}</p>}
          </div>
        )}
      </div>
    </section>
  )
}

function DecisionRow({ d }: { d: NextDecision }) {
  const style = URGENCY_STYLE[d.urgency]
  const detail = d.detail
  const fromSummary = detail?.questionSource === "summary"
  const wait = formatWait(d.waitMs)
  const labels = (
    <>
      <span className="text-sm font-semibold whitespace-nowrap" style={{ color: style.color }}>
        {URGENCY_LABEL[d.urgency]}
      </span>
      <span className="rounded-md border px-1.5 text-sm whitespace-nowrap" data-testid="decision-kind">
        {d.kindLabel}
        {d.estimated && <span className="text-muted-foreground">（推定）</span>}
      </span>
    </>
  )
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 rounded-lg border p-3 xl:grid-cols-[9.5rem_minmax(0,1fr)_auto]"
      style={{ borderLeftWidth: 4, borderLeftColor: style.border }}
      data-testid="decision-row"
      data-urgency={d.urgency}
    >
      {/* 左の札：広い画面では左の列。狭い画面(1024 など)では題名の前に横に並べる。折り返さない */}
      <div className="hidden flex-col items-start gap-1 xl:flex">{labels}</div>

      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="contents xl:hidden">{labels}</span>
          <span className="min-w-0 truncate font-medium">{d.title}</span>
          <span className="text-sm text-muted-foreground">{d.groupName ?? "グループ外"}</span>
        </div>
        {d.happened ? (
          <p className="text-base">{d.happened}</p>
        ) : detail?.question ? (
          <Question
            text={detail.question}
            prefix={fromSummary ? "要約：" : null}
            muted={fromSummary}
            more={detail.moreQuestions > 0 ? `ほか ${detail.moreQuestions}問` : null}
          />
        ) : (
          <p className="text-base text-muted-foreground">問いは取れません（開いて読む）</p>
        )}
        {detail && detail.options.length > 0 && (
          <p className="text-sm" data-testid="decision-options">
            <span className="text-muted-foreground">答えの候補：</span>
            {detail.options.map((o, i) => (
              <span key={i}>
                {i > 0 && "／"}
                {detail.recommended === i ? (
                  <>
                    <strong>{o}</strong>（Claude の推し）
                  </>
                ) : (
                  o
                )}
              </span>
            ))}
            {detail.moreOptions > 0 && <span className="text-muted-foreground">　ほか {detail.moreOptions}</span>}
          </p>
        )}
        {(wait || d.notes.length > 0) && (
          <p className="text-sm text-muted-foreground">{[wait, ...d.notes].filter(Boolean).join("・")}</p>
        )}
      </div>

      <OpenSessionButton sessionId={d.id} className="text-sm" />
    </li>
  )
}

/** 問いの文。3行まで(16px)。超えるときは末尾を「…」にし、［全文を開く］で行の中に全文を出す(A5) */
function Question({ text, prefix, muted, more }: { text: string; prefix: string | null; muted: boolean; more: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [overflow, setOverflow] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const check = () => setOverflow(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, open])
  return (
    <div>
      <p
        ref={ref}
        className={cn("text-base break-words whitespace-pre-wrap", !open && "line-clamp-3", muted && "text-muted-foreground")}
        data-testid="decision-question"
      >
        {prefix}
        {text}
        {more && <span className="ml-2 text-sm text-muted-foreground">（{more}）</span>}
      </p>
      {overflow && !open && (
        <button type="button" onClick={() => setOpen(true)} className="text-sm text-primary hover:underline">
          全文を開く
        </button>
      )}
    </div>
  )
}
