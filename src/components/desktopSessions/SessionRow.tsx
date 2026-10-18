import { Archive, CalendarClock, Folder, ListChecks, MessageSquareText, OctagonAlert, Pin, SquareTerminal, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { isInstructionProvisional } from "@/lib/desktopInstruction"
import type { DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import { ContextBar } from "./ContextBar"
import { InstructionPendingBadge } from "./InstructionPendingBadge"
import { SendCountBadge, SendLimitNotice } from "./Messaging"
import { DesktopStatusBadge } from "./statusMeta"
import { ORIGIN_LABEL, formatAgo } from "./format"

interface SessionRowProps {
  session: DesktopSessionSummary
  highContextRatio: number
  onSelect: (id: string) => void
}

export function SessionRow({ session: s, highContextRatio, onSelect }: SessionRowProps) {
  const instruction = s.latestInstruction
  // 起動直後の暫定の要約のあいだ、人以外の本文は確定した値ではない（全体の解析が終わると人の指示に置き換わりうる）
  const provisional = isInstructionProvisional(s)
  // 人の指示を表示している間に、他セッション・通知からの入力が届いていたら、その旨を添える
  const newerOtherInput =
    instruction?.origin === "human" && s.latestInputOrigin !== null && s.latestInputOrigin !== "human"

  // カード全体を押すと詳細が開く。停止中の警告は「セッションを開く」ボタンを含むため、ボタンの入れ子を避けてカードの外側の枠に並べる
  return (
    <div
      className={cn(
        "rounded-lg border transition-colors hover:border-primary",
        s.messaging?.stopped && "border-[var(--status-critical)]",
        s.isArchived && "opacity-60"
      )}
    >
      <button type="button" onClick={() => onSelect(s.id)} className="w-full rounded-lg p-3 text-left">
        <div className="grid gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1fr)_240px]">
          <div className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <DesktopStatusBadge status={s.status} reason={s.statusReason} />
              <span className="min-w-0 truncate text-sm font-medium">{s.title}</span>
              {s.pinned && <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-label="ピン留め" />}
              {s.group && (
                <Badge variant="secondary" className="shrink-0">
                  {s.group.name}
                </Badge>
              )}
              {s.isRoutine && (
                <Badge variant="outline" className="shrink-0">
                  <CalendarClock aria-hidden />
                  定期実行
                </Badge>
              )}
              <SendCountBadge messaging={s.messaging} />
              {s.cliProcess === "running" && (
                <Badge
                  variant="outline"
                  className="shrink-0"
                  title="claude.exe が --resume でこのセッションを開いています。待機中のセッションでもプロセスは残るため、「実行中」とは別の情報です"
                >
                  <SquareTerminal aria-hidden />
                  CLIプロセスあり
                </Badge>
              )}
              {s.isArchived && (
                <Badge variant="outline" className="shrink-0">
                  <Archive aria-hidden />
                  アーカイブ済み
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {s.folderName && (
                <span className="inline-flex items-center gap-1" title={s.cwd ?? undefined}>
                  <Folder className="size-3" aria-hidden />
                  {s.folderName}
                </span>
              )}
              {s.model && <span>{s.model}</span>}
              {s.effort && <span>エフォート {s.effort}</span>}
              {s.permissionMode && <span>権限 {s.permissionMode}</span>}
              {s.completedTurns !== null && <span>{s.completedTurns}ターン</span>}
              <span>最終活動 {formatAgo(s.lastActivityAt)}</span>
              {s.queuedInputs > 0 && <span>待機中の入力 {s.queuedInputs}件</span>}
            </div>

            {s.needsActionExcerpt && (
              <p className="flex min-w-0 items-start gap-1.5 text-xs">
                <OctagonAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--status-critical)]" aria-hidden />
                <span className="shrink-0 font-medium">要対応</span>
                <span className="min-w-0 truncate" title={s.needsActionExcerpt}>
                  {s.needsActionExcerpt}
                </span>
              </p>
            )}

            {instruction || provisional ? (
              <p className="flex min-w-0 items-start gap-1.5 text-xs">
                <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                {instruction && instruction.origin !== "human" && (
                  <Badge variant="outline" className="shrink-0">
                    <Users aria-hidden />
                    {ORIGIN_LABEL[instruction.origin]}
                  </Badge>
                )}
                {provisional && <InstructionPendingBadge />}
                {instruction && (
                  <span className={cn("min-w-0 truncate", provisional && "text-muted-foreground")}>
                    {instruction.excerpt || "（本文なし）"}
                  </span>
                )}
                {newerOtherInput && s.latestInputOrigin && (
                  <span className="shrink-0 text-muted-foreground">
                    ／その後に{ORIGIN_LABEL[s.latestInputOrigin]}からの入力あり
                  </span>
                )}
              </p>
            ) : (
              s.transcript === "missing" && (
                <p className="text-xs text-muted-foreground">会話ログが見つからないため、指示・フェーズは表示できません。</p>
              )
            )}
          </div>

          <div className="min-w-0 space-y-2">
            <ContextBar context={s.context} highRatio={highContextRatio} />
            {s.phase && (
              <p className="flex min-w-0 items-center gap-1.5 text-xs">
                <ListChecks className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="shrink-0 tabular-nums">
                  {s.phase.completed}/{s.phase.total}
                </span>
                {s.phase.currentStep && (
                  <span className="min-w-0 truncate text-muted-foreground" title={s.phase.currentStep}>
                    {s.phase.currentStep}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      </button>
      <SendLimitNotice sessionId={s.id} messaging={s.messaging} className="mx-3 mb-3" />
    </div>
  )
}
