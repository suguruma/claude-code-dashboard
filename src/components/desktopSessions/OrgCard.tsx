"use client"

import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"
import type { DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import { formatElapsed, leaderPhaseText, pulseSeconds, workRatio, type CardPhase, type MemberState } from "@/lib/flowPlayback"
import { FLOW_WORK_FULL, type FlowMember } from "@/lib/flowTypes"
import { ContextBar } from "./ContextBar"
import { SendCountBadge, SendLimitNotice } from "./Messaging"
import { DesktopStatusBadge } from "./statusMeta"

/** カードに一時的に出す強調(線の粒が着いたときの枠・圧縮の印・コンテキストの増えた分) */
export interface CardFx {
  flash?: "down" | "up" | "cross"
  compact?: boolean
  /** 増えた分(「+28K」)。1,000トークン以上増えたときだけ */
  delta?: string
}

const PHASE_TEXT: Record<CardPhase, string> = {
  idle: "作業なし",
  working: "作業中",
  reported: "報告済み",
  noreport: "報告なしで終了",
}

const PHASE_DOT: Record<CardPhase, string> = {
  idle: "bg-muted-foreground/40",
  working: "bg-[var(--flow-work)]",
  reported: "bg-[var(--flow-up)]",
  noreport: "bg-muted-foreground",
}

interface OrgCardProps {
  /** 層: 1=指揮役 / 2=指揮役の子 / 3=子が作った補助のセッション(確認用の属性 `data-depth`) */
  depth: 1 | 2 | 3
  member: FlowMember
  state: MemberState
  /** 一覧のセッション情報(状態バッジ・送信回数・要約)。一覧に無ければ null */
  summary: DesktopSessionSummary | null
  highContextRatio: number
  /** 「最後の出来事から」の基準になる時刻(ライブでは現在、振り返りでは再生位置) */
  referenceTime: number
  fx: CardFx | undefined
  /** 指揮役のカード(上): 作業量バーは無く、指示・報告の件数と作業中の子の数を出す */
  leader?: { instructs: number; reports: number; working: number }
  onSelect: (id: string) => void
  cardRef: (el: HTMLDivElement | null) => void
}

/**
 * 組織図のカード。カード全体を押すとセッション詳細が開く。送信上限の警告は「セッションを開く」ボタンを含むため、
 * ボタンの入れ子を避けて、押せる領域の外側に並べる。
 */
export function OrgCard({ depth, member, state, summary, highContextRatio, referenceTime, fx, leader, onSelect, cardRef }: OrgCardProps) {
  const limit = member.contextLimit ?? summary?.context?.limit ?? null
  const context =
    state.ctx !== null && limit
      ? { tokens: state.ctx, limit, ratio: Math.min(1, state.ctx / limit) }
      : null
  const workPercent = Math.round(workRatio(state.tools) * 100)
  const working = state.phase === "working"
  const style = {
    "--org-pulse": `${pulseSeconds(state.callsPerMinute).toFixed(2)}s`,
    "--org-glow": `${(4 + workRatio(state.tools) * 6).toFixed(1)}px`,
  } as CSSProperties

  const phaseText = leader
    ? leaderPhaseText(working, leader.working)
    : working
      ? // 親からの指示が無いまま動いているとき(人の入力で動く子・3層目の補助のセッション)は、指示ごとの作業量が無い
        state.tools > 0
        ? `作業中（ツール${state.tools}回）`
        : "作業中"
      : PHASE_TEXT[state.phase]

  return (
    <div
      ref={cardRef}
      data-testid={leader ? "org-top" : "org-card"}
      data-session-id={member.id}
      data-depth={depth}
      data-parent-id={member.parentId ?? undefined}
      data-state={state.phase}
      data-flash={fx?.flash}
      style={style}
      className={cn(
        "org-card relative z-[1] min-w-0 rounded-xl border bg-card text-card-foreground shadow-xs",
        leader && "mx-auto w-[min(320px,100%)] border-2",
        summary?.messaging?.stopped && "border-[var(--status-critical)]",
        summary?.isArchived && "opacity-60"
      )}
    >
      <button type="button" onClick={() => onSelect(member.id)} className="block w-full min-w-0 space-y-1.5 rounded-xl p-2.5 text-left">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-medium leading-tight" title={member.title}>
            {member.title}
          </h3>
          <p className="truncate text-[11px] text-muted-foreground">{member.model ?? "モデル不明"}</p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {summary && <DesktopStatusBadge status={summary.status} reason={summary.statusReason} info={summary.needsActionInfo} standby={summary.standbyInfo} />}
          <SendCountBadge messaging={summary?.messaging ?? null} />
          {member.sideChats > 0 && (
            <span
              className="inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground"
              title="このセッションから開いたサイドチャット（脇の会話）の数。サイドチャットはカードにしない"
              data-testid="org-side-chats"
            >
              サイドチャット {member.sideChats}
            </span>
          )}
        </div>

        <p className="flex min-w-0 items-center gap-1.5 text-xs" data-testid="org-phase">
          <span className={cn("size-2 shrink-0 rounded-full", PHASE_DOT[state.phase])} aria-hidden />
          <span className={cn("truncate", state.phase === "noreport" && "text-muted-foreground")}>{phaseText}</span>
        </p>

        {leader ? (
          <p className="text-[11px] tabular-nums text-muted-foreground" data-testid="org-leader-counts">
            指示 {leader.instructs} ／ 報告 {leader.reports}
          </p>
        ) : (
          <div className="space-y-0.5">
            <div className="flex justify-between gap-1 text-[11px] text-muted-foreground">
              <span>作業量</span>
              <span className="tabular-nums text-foreground">{state.tools > 0 ? `ツール ${state.tools}回` : "—"}</span>
            </div>
            <div
              role="meter"
              aria-label="作業量"
              aria-valuemin={0}
              aria-valuemax={FLOW_WORK_FULL}
              aria-valuenow={Math.min(state.tools, FLOW_WORK_FULL)}
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              {/* 量を示すだけなので中立の色にする(状態の色〈橙=深刻〉を使うと警告に見える) */}
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${state.tools > 0 ? Math.max(4, workPercent) : 0}%` }}
              />
            </div>
          </div>
        )}

        <div className="relative space-y-0.5">
          <ContextBar context={context} highRatio={highContextRatio} levels compact />
          {fx?.compact && (
            <span className="org-fade absolute -top-3 right-0 rounded bg-[var(--status-warning)] px-1 text-[10px] font-medium text-black" data-testid="org-compact">
              圧縮
            </span>
          )}
          {fx?.delta && (
            <span className="org-delta absolute -top-3 left-0 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground tabular-nums" data-testid="org-delta">
              {fx.delta}
            </span>
          )}
        </div>

        {!leader && (
          <p className="truncate text-[11px] text-muted-foreground" title={state.lastInstruct ?? undefined}>
            {state.lastInstruct ? `最新の指示：${state.lastInstruct}` : "指示なし"}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground" data-testid="org-last-event">
          {state.lastEventAt === null ? "出来事なし" : `最終 ${formatElapsed(referenceTime - state.lastEventAt)}`}
        </p>
      </button>
      <SendLimitNotice sessionId={member.id} messaging={summary?.messaging ?? null} className="mx-2.5 mb-2.5" />
    </div>
  )
}
