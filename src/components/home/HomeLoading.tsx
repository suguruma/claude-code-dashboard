"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * ホームの段階的な表示(⑫)の部品。読み込み中の灰色の枠・時間がかかっているときの案内・失敗と［もう一度読み込む］。
 * 色は既存のトークンだけ(読み込み中は灰。失敗は --status-critical-text)。新しく足す文は14px(text-sm)以上。
 */

/** 数字や名前の場所の灰色の枠(動かない。読み上げでは読まない) */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cn("block rounded-md bg-muted", className)} style={style} />
}

interface RetryNoticeProps {
  /** slow: 時間がかかっている(要求は続けている) / failed: サーバーが失敗を返した・つながらなかった */
  phase: "slow" | "failed"
  /** 案内の文(「〜に時間がかかっています（30秒以上）。このまま待てます。」など) */
  text: string
  onRetry: () => Promise<unknown>
  className?: string
}

/**
 * 案内の文と［もう一度読み込む］。押したらボタンを無効にして「もう一度読み込んでいます」に変え、出し直しが終わるまで押せない
 * (画面の側の要求は1本だけ)。失敗が続いたら「もう一度失敗しました（〇回目）」。
 * role="status" に入れるのは、この案内の文だけ(秒ごとに変わる文は入れない)
 */
export function RetryNotice({ phase, text, onRetry, className }: RetryNoticeProps) {
  const [retrying, setRetrying] = useState(false)
  const [failures, setFailures] = useState(0)
  const phaseRef = useRef(phase)
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const retry = async () => {
    setRetrying(true)
    try {
      await onRetry()
    } catch {
      // 失敗は、欄の状態(phase)で出す
    }
    setRetrying(false)
    if (phaseRef.current === "failed") setFailures((n) => n + 1)
  }

  const message = phase === "failed" && failures > 0 ? `！ もう一度失敗しました（${failures + 1}回目）。${text.replace(/^！\s*/, "")}` : text
  return (
    <div
      className={cn("flex flex-wrap items-center gap-3 text-sm", className)}
      data-testid="retry-notice"
      data-phase={phase}
    >
      <span role="status" style={phase === "failed" ? { color: "var(--status-critical-text)" } : undefined} className={phase === "failed" ? undefined : "text-muted-foreground"}>
        {message}
      </span>
      {/* 新しく足す文は14px 以上(要件メモ 4-2)。size="sm" は 0.8rem になるので、既定の大きさ(text-sm)を使う */}
      <Button type="button" variant="outline" disabled={retrying} onClick={retry}>
        {retrying ? "もう一度読み込んでいます" : "もう一度読み込む"}
      </Button>
    </div>
  )
}

interface OrgLoadingFrameProps {
  /** 枠の高さ(px)。2回目からは前回の組織図の高さ(グループ・範囲ごと) */
  height: number
  /** loading・slow・failed は組織図の読み込み。blocked は一覧が読めないため出せない */
  state: "loading" | "slow" | "failed" | "blocked"
  /** failed のときの理由 */
  reason?: string
  onRetry?: () => Promise<unknown>
}

/**
 * 組織図の枠(読み込み後と同じ並び：4つの数字 → 組織図のカード)。高さは前回と同じにし、組織図が出ても画面がずれにくくする(⑫ ST-6)。
 * 棒は「動いている印」で、進み具合ではない(画面の側は答えを待っているだけで、進み具合を知らないため)
 */
export function OrgLoadingFrame({ height, state, reason, onRetry }: OrgLoadingFrameProps) {
  const busy = state === "loading" || state === "slow"
  return (
    <div className="flex flex-col gap-3" style={{ height }} aria-busy={busy} data-testid="org-loading-frame" data-state={state}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {["指示（本）", "報告（本）", "報告なしで終了（件）", "作業中（件）"].map((label) => (
          <div key={label} className="rounded-xl border bg-card px-3 py-2">
            {state === "failed" || state === "blocked" ? (
              <span className="block text-sm leading-7 text-muted-foreground">取得できません</span>
            ) : (
              <Skeleton className="my-1 h-5 w-9" />
            )}
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
      <div
        className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4")}
        style={state === "failed" ? { borderColor: "var(--status-critical)" } : undefined}
      >
        {busy && <div className="loading-flow" aria-hidden />}
        {/* 案内と［もう一度読み込む］は、枠のいちばん上(読み込み中の文と同じ高さ)に出す。枠は前回の組織図の高さなので、
            縦の真ん中に置くと、1280×900 の窓では画面の外になる(⑫ 確認 中1) */}
        {state === "loading" && <p className="text-sm text-muted-foreground">組織図を読み込んでいます。ここに組織図が出ます。</p>}
        {state === "slow" && onRetry && (
          <RetryNotice
            phase="slow"
            text="時間がかかっています（30秒以上）。このまま待てます。PC が混んでいるかもしれません。"
            onRetry={onRetry}
          />
        )}
        {state === "failed" && onRetry && (
          <RetryNotice
            phase="failed"
            text={`！ 組織図を読み込めませんでした（${reason ?? "サーバーがエラーを返しました"}）。件数と利用上限は使えます。`}
            onRetry={onRetry}
          />
        )}
        {state === "blocked" && <p className="text-sm text-muted-foreground">セッションの一覧を読み込めないため、組織図を出せません。</p>}
        {busy && (
          <>
            <div className="flex justify-center" aria-hidden>
              <Skeleton className="h-28 w-48 border border-dashed" />
            </div>
            <div className="flex justify-center gap-6" aria-hidden>
              <Skeleton className="h-28 w-48 border border-dashed" />
              <Skeleton className="h-28 w-48 border border-dashed" />
              <Skeleton className="h-28 w-48 border border-dashed" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** グループのタブの行の枠(一覧が来る前。読み込み後のタブの行と同じ高さ) */
export function OrgTabsSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-hidden data-testid="org-tabs-skeleton">
      <div className="flex gap-1.5">
        <Skeleton className="h-[30px] w-28 rounded-full" />
        <Skeleton className="h-[30px] w-24 rounded-full" />
      </div>
      <div className="ml-auto">
        <Skeleton className="h-8 w-80" />
      </div>
    </div>
  )
}
