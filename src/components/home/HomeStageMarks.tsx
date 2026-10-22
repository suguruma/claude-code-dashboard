"use client"

import { X } from "lucide-react"
import { useHomeStages } from "@/hooks/useHomeStages"
import { useTicker } from "@/hooks/useStartupTimes"
import { ELAPSED_SHOW_MS, STAGE_LABEL, STAGE_TARGET_ID, markSymbol, type StageMark } from "@/lib/homeStartup"

/**
 * 上のバーの段階の印(⑫ ST-9)。件数・利用上限・組織図の3つを、記号と文字で出す(色だけに頼らない)。
 * 1.5秒以上待ったときだけ出し、そろったら消す(速い PC では出ない)。失敗の印は、直るか閉じるまで残す。
 * 印を押すと、その欄へ移る。秒の数は、ここ1か所だけ(読み上げの対象にはしない)。狭い上のバーでは「読み込み中 2/3」の1つに畳む。
 */
export function HomeStageMarks() {
  const stages = useHomeStages()
  const visible = Boolean(stages?.view.visible)
  const waiting = stages ? stages.view.done + stages.marks.filter((m) => m.phase === "failed").length < stages.view.total : false
  // 秒は、この小さな部品の中だけで1秒ごとに数える(ホーム全体は描き直さない)
  const now = useTicker(visible && waiting, 1_000)
  if (!stages || !visible) return null
  const { marks, view, startedAt, dismissFailure } = stages
  const anyFailed = marks.some((m) => m.phase === "failed")
  const elapsedMs = now > 0 && startedAt > 0 ? now - startedAt : 0
  const elapsedSeconds = elapsedMs >= ELAPSED_SHOW_MS ? Math.floor(elapsedMs / 1000) : null
  const summary = `読み込み中 ${view.done}/${view.total}`

  return (
    <div className="flex min-w-0 items-center gap-2 text-sm" data-testid="home-stage-marks">
      <div className="hidden items-center gap-2 @3xl:flex">
        {marks.map((mark) => (
          <MarkButton key={mark.id} mark={mark} />
        ))}
      </div>
      {waiting && (
        <span className="shrink-0 text-muted-foreground tabular-nums" data-testid="home-stage-elapsed">
          {summary}
          {elapsedSeconds !== null && <span aria-hidden>・{elapsedSeconds}秒</span>}
        </span>
      )}
      {anyFailed && (
        <>
          <span className="@3xl:hidden" style={{ color: "var(--status-critical-text)" }}>
            ！ 読み込めない欄があります
          </span>
          <button
            type="button"
            onClick={dismissFailure}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="失敗の印を閉じる"
          >
            <X className="size-4" aria-hidden />
          </button>
        </>
      )}
    </div>
  )
}

function MarkButton({ mark }: { mark: StageMark }) {
  const label = STAGE_LABEL[mark.id]
  const color =
    mark.phase === "ready" ? "var(--status-good-text)" : mark.phase === "failed" ? "var(--status-critical-text)" : undefined
  const state = mark.phase === "ready" ? "済み" : mark.phase === "failed" ? "読み込めませんでした" : "読み込み中"
  return (
    <button
      type="button"
      onClick={() => {
        const target = document.getElementById(STAGE_TARGET_ID[mark.id])
        target?.scrollIntoView({ block: "start", behavior: "smooth" })
      }}
      className="shrink-0 rounded-full border bg-card px-2.5 py-0.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ color: color ?? "var(--muted-foreground)", borderColor: mark.phase === "failed" ? "var(--status-critical)" : undefined }}
      aria-label={`${label}：${state}（押すとその欄へ移ります）`}
      data-phase={mark.phase}
    >
      {markSymbol(mark.phase)} {label}
    </button>
  )
}
