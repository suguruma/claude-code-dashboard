"use client"

import { AlertTriangle, MailX, OctagonAlert, Send, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DECISION_REASON_LABEL } from "@/lib/housekeepingFormat"
import type { DecisionItem, DecisionReason, HousekeepingResponse } from "@/lib/housekeepingTypes"
import { formatAgo } from "./format"
import { EmptyNote, LimitedList, SectionHeading } from "./HousekeepingList"
import { OpenSessionButton } from "./Messaging"

const REASON_ICON: Record<DecisionReason, { Icon: LucideIcon; color: string }> = {
  "needs-action": { Icon: OctagonAlert, color: "var(--status-critical)" },
  "send-limit": { Icon: Send, color: "var(--status-critical)" },
  error: { Icon: AlertTriangle, color: "var(--status-critical)" },
  undelivered: { Icon: MailX, color: "var(--status-warning)" },
}

function DecisionRow({ item, onSelect }: { item: DecisionItem; onSelect: (id: string) => void }) {
  return (
    <div className="rounded-lg border p-3 transition-colors hover:border-primary">
      <div className="grid gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {item.reasons.map((reason) => {
              const { Icon, color } = REASON_ICON[reason]
              return (
                <Badge key={reason} variant="outline">
                  <Icon style={{ color }} aria-hidden />
                  {DECISION_REASON_LABEL[reason]}
                  {reason === "undelivered" && item.undeliveredCount > 0 ? `（${item.undeliveredCount}件）` : ""}
                </Badge>
              )
            })}
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              className="min-w-0 truncate rounded-sm text-left text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              title="セッションの詳細を開く"
            >
              {item.title}
            </button>
            {item.groupName && <Badge variant="secondary">{item.groupName}</Badge>}
          </div>
          {item.excerpt && <p className="text-sm">{item.excerpt}</p>}
          <p className="text-xs text-muted-foreground">最後の活動: {formatAgo(item.lastActivityAt)}</p>
        </div>
        <OpenSessionButton sessionId={item.id} className="justify-self-start md:justify-self-end" />
      </div>
    </div>
  )
}

/** C. オーナーの判断待ち。要対応 → 送信上限で停止 → エラー → 届かなかった送信 の順 */
export function HousekeepingDecisionList({
  data,
  onSelect,
}: {
  data: HousekeepingResponse["decisions"]
  onSelect: (id: string) => void
}) {
  return (
    <section aria-labelledby="hk-decisions" className="space-y-3">
      <SectionHeading
        id="hk-decisions"
        title="あなたの判断を待っているセッション"
        count={data.items.length}
        description="全グループ（グループ外を含む）のうち、要対応・送信上限で停止中・エラー・届かなかった送信があるセッション。この順に並べ、同じ区分の中では、最後の活動が古いものを先に出します。"
      />
      {data.items.length === 0 ? (
        <EmptyNote>判断を待っているセッションはありません。</EmptyNote>
      ) : (
        <LimitedList
          items={data.items}
          keyOf={(i) => i.id}
          label="判断待ちのセッション"
          renderItem={(item) => <DecisionRow item={item} onSelect={onSelect} />}
        />
      )}
    </section>
  )
}
