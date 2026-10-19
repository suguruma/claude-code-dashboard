"use client"

import { useEffect, useRef } from "react"
import { CheckCircle2, ChevronLeft, Circle, CircleDot } from "lucide-react"
import { useDesktopSessionDetail } from "@/hooks/useDesktopSessions"
import { isInstructionProvisional } from "@/lib/desktopInstruction"
import type { TaskStatus } from "@/lib/desktopSessionTypes"
import { NEEDS_ACTION_KIND_LABEL, needsActionSourceLabel } from "@/lib/needsActionKind"
import { PHONE_SWR_OPTIONS } from "@/lib/phoneView"
import { cn } from "@/lib/utils"
import { ORIGIN_LABEL, formatAgo, formatDateTime, formatTokens } from "@/components/desktopSessions/format"
import { META, PhoneContextMeter, PhoneNotice, PhoneStatusBadge } from "./parts"
import { closeSession } from "./sessionHash"

const TASK_ICON: Record<TaskStatus, { Icon: typeof Circle; label: string; className: string }> = {
  completed: { Icon: CheckCircle2, label: "完了", className: "text-[var(--status-good)]" },
  in_progress: { Icon: CircleDot, label: "実行中", className: "text-primary" },
  pending: { Icon: Circle, label: "未着手", className: "text-muted-foreground" },
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 py-2">
      <dt className={META}>{label}</dt>
      <dd className="mt-0.5 text-base [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/**
 * セッションの詳細(全画面のシート。Q19)。詳細の API の値だけを出す(読み取り専用。PC でしか開けないリンクは出さない)。
 * 戻るのボタン・ブラウザの戻る・Esc で閉じる。
 */
export function PhoneSessionSheet({ sessionId }: { sessionId: string }) {
  const { detail, error, isLoading } = useDesktopSessionDetail(sessionId, PHONE_SWR_OPTIONS)
  const backRef = useRef<HTMLButtonElement>(null)
  const provisional = detail ? isInstructionProvisional(detail) : false

  useEffect(() => {
    // 開いているあいだは、後ろのページがスクロールしないようにする
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    backRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSession()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener("keydown", onKey)
    }
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="phone-sheet-title"
      className="fixed inset-0 z-50 flex flex-col bg-background"
      data-testid="phone-session-sheet"
    >
      <div className="border-b pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex min-h-14 max-w-xl items-center gap-1 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(0.25rem,env(safe-area-inset-left))]">
          <button
            ref={backRef}
            type="button"
            onClick={closeSession}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center gap-0.5 rounded-lg px-2 text-base text-primary active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="phone-sheet-back"
          >
            <ChevronLeft className="size-5" aria-hidden />
            戻る
          </button>
          <h2 id="phone-sheet-title" className="min-w-0 flex-1 truncate text-base font-semibold">
            {detail?.title ?? "セッションの詳細"}
          </h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-xl space-y-5 px-[max(1rem,env(safe-area-inset-left))] pt-4 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
          <PhoneNotice error={error} isLoading={isLoading} hasData={detail !== null} />

          {detail && (
            <>
              <section className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <PhoneStatusBadge status={detail.status} info={detail.needsActionInfo} standby={detail.standbyInfo} />
                  {detail.group && <span className="rounded-full bg-muted px-2 py-0.5 text-[0.8125rem]">{detail.group.name}</span>}
                </div>
                <p className={META}>判断の根拠：{detail.statusReason}</p>
                {detail.messaging?.stopped && (
                  <p className="rounded-lg border border-[var(--status-critical)] p-3 text-base">
                    送信上限で停止中です。PC でこのセッションに一言入力すると解除されます。
                  </p>
                )}
              </section>

              {(detail.needsActionExcerpt || detail.needsActionInfo) && (
                <section className="space-y-1">
                  <h3 className="text-base font-semibold">要対応の内容</h3>
                  {detail.needsActionExcerpt && <p className="text-base [overflow-wrap:anywhere]">{detail.needsActionExcerpt}</p>}
                  {detail.needsActionInfo && (
                    <p className={META}>
                      {NEEDS_ACTION_KIND_LABEL[detail.needsActionInfo.kind]}
                      {detail.needsActionInfo.estimated ? "（推定）" : ""}・手がかり：
                      {needsActionSourceLabel(detail.needsActionInfo.source, detail.needsActionInfo.buttons)}
                    </p>
                  )}
                </section>
              )}

              <section className="space-y-1">
                <h3 className="text-base font-semibold">コンテキスト</h3>
                <PhoneContextMeter context={detail.context} label={false} />
                {detail.context && (
                  <p className={META}>
                    {formatTokens(detail.context.tokens)} / {formatTokens(detail.context.limit)}（上限は仮置き）
                  </p>
                )}
              </section>

              <section className="space-y-1">
                <h3 className="text-base font-semibold">最新の指示</h3>
                {detail.latestInstruction ? (
                  <p className={cn("text-base [overflow-wrap:anywhere]", provisional && "text-muted-foreground")}>
                    <span className="mr-1.5 rounded border px-1.5 py-px text-[0.8125rem]">{ORIGIN_LABEL[detail.latestInstruction.origin]}</span>
                    {detail.latestInstruction.excerpt || "（本文なし）"}
                    <span className={cn(META, "ml-1.5")}>{formatAgo(detail.latestInstruction.at)}</span>
                  </p>
                ) : (
                  <p className="text-base text-muted-foreground">表示できる指示がありません。</p>
                )}
              </section>

              <section className="space-y-1">
                <h3 className="text-base font-semibold">
                  タスクリスト
                  {detail.phase && (
                    <span className={cn(META, "ml-2 font-normal tabular-nums")}>
                      {detail.phase.completed}/{detail.phase.total} 完了
                    </span>
                  )}
                </h3>
                {detail.tasks.length > 0 ? (
                  <ul className="space-y-1.5">
                    {detail.tasks.map((task, index) => {
                      const { Icon, label, className } = TASK_ICON[task.status]
                      return (
                        <li key={index} className="flex items-start gap-2 text-base">
                          <Icon className={cn("mt-1 size-4 shrink-0", className)} aria-label={label} />
                          <span className={cn("[overflow-wrap:anywhere]", task.status === "completed" && "text-muted-foreground")}>
                            {task.content || "（名称なし）"}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="text-base text-muted-foreground">タスクリストはありません。</p>
                )}
              </section>

              <dl className="divide-y border-t">
                <Row label="最後の動き">
                  {formatAgo(detail.lastActivityAt)}（{formatDateTime(detail.lastActivityAt)}）
                </Row>
                <Row label="作業フォルダ">{detail.folderName ?? "—"}</Row>
                <Row label="モデル">{detail.model ?? "—"}</Row>
                <Row label="ターン数">{detail.completedTurns ?? "—"}</Row>
                <Row label="他のセッションへの送信（人の最後の入力から）">
                  {detail.messaging
                    ? `${detail.messaging.sent}${detail.messaging.exact ? "" : "以上"} / ${detail.messaging.limit}回${
                        detail.messaging.undelivered > 0 ? `（未達${detail.messaging.undelivered}件）` : ""
                      }`
                    : "—"}
                </Row>
              </dl>
              <p className={META}>会話の本文は表示しません（先頭60文字の抜粋だけです）。</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
