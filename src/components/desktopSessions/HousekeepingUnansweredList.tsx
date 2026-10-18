"use client"

import { ArrowRight, CircleHelp, Hourglass, MailQuestionMark, Activity, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { UNANSWERED_KIND_HINT, UNANSWERED_KIND_LABEL, formatDuration } from "@/lib/housekeepingFormat"
import type { HousekeepingResponse, UnansweredInstruction, UnansweredKind } from "@/lib/housekeepingTypes"
import { EmptyNote, LimitedList, SectionHeading } from "./HousekeepingList"
import { OpenSessionButton } from "./Messaging"

const KIND_ICON: Record<UnansweredKind, { Icon: LucideIcon; color: string }> = {
  "ended-without-report": { Icon: CircleHelp, color: "var(--status-warning)" },
  "awaiting-report": { Icon: Hourglass, color: "var(--muted-foreground)" },
  "possibly-undelivered": { Icon: MailQuestionMark, color: "var(--status-critical)" },
}

function UnansweredRow({ item, onSelect }: { item: UnansweredInstruction; onSelect: (id: string) => void }) {
  const { Icon, color } = KIND_ICON[item.kind]
  return (
    <div className="rounded-lg border p-3 transition-colors hover:border-primary">
      <div className="grid gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="outline" title={UNANSWERED_KIND_HINT[item.kind]}>
              <Icon style={{ color }} aria-hidden />
              {UNANSWERED_KIND_LABEL[item.kind]}
            </Badge>
            {item.working && (
              <Badge variant="secondary" title="宛先のセッションは、いま作業中と推定されます（会話ログの更新状況から）">
                <Activity aria-hidden />
                宛先は作業中
              </Badge>
            )}
            <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
              <span className="min-w-0 truncate font-medium">{item.fromTitle}</span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="から" />
              <button
                type="button"
                onClick={() => onSelect(item.toId)}
                className="min-w-0 truncate rounded-sm text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                title="宛先のセッションの詳細を開く"
              >
                {item.toTitle}
              </button>
            </span>
            <Badge variant="secondary">{item.groupName}</Badge>
          </div>
          <p className="text-sm">
            <span className="text-muted-foreground">指示: </span>
            {item.summary || "（本文なし）"}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatDuration(item.ageMs)}前に送信（
            {new Date(item.sentAt).toLocaleString("ja-JP", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）
          </p>
        </div>
        <OpenSessionButton sessionId={item.toId} className="justify-self-start md:justify-self-end" />
      </div>
    </div>
  )
}

/** B. 返事の無い指示。古い指示から */
export function HousekeepingUnansweredList({
  data,
  onSelect,
}: {
  data: HousekeepingResponse["unanswered"]
  onSelect: (id: string) => void
}) {
  return (
    <section aria-labelledby="hk-unanswered" className="space-y-3">
      <SectionHeading
        id="hk-unanswered"
        title="返事の来ていない指示"
        count={data.items.length}
        description={`直近${data.rangeHours}時間に、指揮役などが他のセッションへ送った指示のうち、報告が付いていないもの。報告なしで終了したものは、時間にかかわらず出します。報告待ち・未達の疑いは、${data.thresholdMinutes}分以上たったものを出します。古い指示から並べます。`}
      />
      {data.items.length === 0 ? (
        <EmptyNote>返事の来ていない指示はありません。</EmptyNote>
      ) : (
        <LimitedList
          items={data.items}
          keyOf={(i) => `${i.fromId}:${i.toId}:${i.sentAt}`}
          label="返事の来ていない指示"
          renderItem={(item) => <UnansweredRow item={item} onSelect={onSelect} />}
        />
      )}
    </section>
  )
}
