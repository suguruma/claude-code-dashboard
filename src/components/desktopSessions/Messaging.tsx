"use client"

import { ExternalLink, OctagonAlert, Send } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { DesktopSessionMessaging } from "@/lib/desktopSessionTypes"
import { SEND_LIMIT, sendLevel, sessionDeepLink, type SendLevel } from "@/lib/sessionMessaging"

// color: アイコンの色。textColor: 文字の色(AA。アイコン・枠より暗い/明るい文字用のトークン)
const LEVEL_STYLE: Record<Exclude<SendLevel, "none">, { className: string; color: string; textColor: string }> = {
  ok: { className: "border-border", color: "var(--muted-foreground)", textColor: "var(--muted-foreground)" },
  warn: {
    className:
      "border-[var(--status-warning)] bg-[color-mix(in_oklab,var(--status-warning)_16%,transparent)]",
    color: "var(--status-warning)",
    textColor: "var(--status-warning-text)",
  },
  limit: {
    className:
      "border-[var(--status-critical)] bg-[color-mix(in_oklab,var(--status-critical)_14%,transparent)] font-semibold",
    color: "var(--status-critical)",
    textColor: "var(--status-critical-text)",
  },
}

/**
 * 他のセッションへ送ったメッセージの数。人が最後に入力してからの回数で、上限は10回。
 * 8回以上で黄、上限で赤。色だけに頼らず、数字とアイコンを併記する。送っていないセッションには出さない。
 */
export function SendCountBadge({ messaging, className }: { messaging: DesktopSessionMessaging | null; className?: string }) {
  if (!messaging) return null
  const level = sendLevel(messaging.sent, messaging.stopped)
  if (level === "none") return null
  const style = LEVEL_STYLE[level]
  const title = [
    `人が最後に入力してから、他のセッションへ送ったメッセージの数（上限${SEND_LIMIT}回）。`,
    "他のセッションから届いたメッセージでは数え直されません。",
    messaging.undelivered > 0 ? `うち${messaging.undelivered}件は届いていません。` : null,
    messaging.exact ? null : "会話ログを全体解析中のため、実際の回数はこれ以上の可能性があります。",
  ]
    .filter(Boolean)
    .join("")
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums",
        style.className,
        className
      )}
      title={title}
    >
      <Send className="size-3" style={{ color: style.color }} aria-hidden />
      送信 {messaging.sent}
      {messaging.exact ? "" : "+"}/{messaging.limit}
      {messaging.undelivered > 0 && (
        <span className="font-normal" style={{ color: style.textColor }}>
          （未達{messaging.undelivered}）
        </span>
      )}
    </span>
  )
}

/**
 * Claude Desktopでそのセッションを開く。配布exeはメインプロセス経由(許可した形式のURLだけ)、ブラウザはリンクの遷移で開く。
 * Desktopのセッション識別子(`local_…`)でなければ、押しても開けないので出さない。
 */
export function OpenSessionButton({ sessionId, className }: { sessionId: string; className?: string }) {
  const link = sessionDeepLink(sessionId)
  if (!link) return null

  async function open() {
    if (!link) return
    const api = window.electronAPI
    if (api?.openExternal) {
      const result = await api.openExternal(link)
      if (!result.ok) toast.error("セッションを開けませんでした。Claude Desktopが起動しているか確認してください")
      return
    }
    window.location.href = link
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      title="Claude Desktopでこのセッションを開きます"
      onClick={() => void open()}
    >
      <ExternalLink aria-hidden />
      セッションを開く
    </Button>
  )
}

/**
 * 送信上限で止まっているセッションの警告。止まったままでは他のセッションへ何も送れない。
 * 人がこのセッションに入力すると解除される。
 */
export function SendLimitNotice({
  sessionId,
  messaging,
  className,
}: {
  sessionId: string
  messaging: DesktopSessionMessaging | null
  className?: string
}) {
  if (!messaging?.stopped) return null
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-[var(--status-critical)] bg-[color-mix(in_oklab,var(--status-critical)_12%,transparent)] px-2.5 py-2",
        className
      )}
    >
      <OctagonAlert className="size-4 shrink-0 text-[var(--status-critical)]" aria-hidden />
      <span className="text-sm font-semibold text-[var(--status-critical-text)]">送信上限で停止中</span>
      <span className="min-w-[min(14rem,100%)] flex-1 text-xs text-foreground">
        他のセッションへ送れる回数（{messaging.limit}回）に達しています。このセッションで一言入力すると解除されます
      </span>
      {/* 狭いカードでも枠からはみ出さない: 幅を超えるときは文字を折り返して、ボタンを枠の幅に収める */}
      <OpenSessionButton sessionId={sessionId} className="h-auto min-h-7 max-w-full min-w-0 whitespace-normal px-2 py-1 text-left" />
    </div>
  )
}
