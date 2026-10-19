"use client"

import { AlertTriangle, MailX, OctagonAlert, Send, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DECISION_REASON_LABEL } from "@/lib/housekeepingFormat"
import type { DecisionItem, DecisionReason, HousekeepingResponse } from "@/lib/housekeepingTypes"
import { NEEDS_ACTION_KIND_LABEL, needsActionSourceLabel } from "@/lib/needsActionKind"
import { NEEDS_ACTION_ICON } from "./statusMeta"
import { formatAgo } from "./format"
import { EmptyNote, LimitedList, SectionHeading, openOnRowClick } from "./HousekeepingList"
import { OpenSessionButton } from "./Messaging"

const REASON_ICON: Record<DecisionReason, { Icon: LucideIcon; color: string }> = {
  "needs-action": { Icon: OctagonAlert, color: "var(--status-critical)" },
  "send-limit": { Icon: Send, color: "var(--status-critical)" },
  error: { Icon: AlertTriangle, color: "var(--status-critical)" },
  undelivered: { Icon: MailX, color: "var(--status-warning)" },
}

function DecisionRow({ item, onSelect }: { item: DecisionItem; onSelect: (id: string) => void }) {
  return (
    <div className="cursor-pointer rounded-lg border p-3 transition-colors hover:border-primary" onClick={openOnRowClick(onSelect, item.id)}>
      <div className="grid gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {item.reasons.map((reason) => {
              const { Icon: ReasonIcon, color } = REASON_ICON[reason]
              // 要対応は、種類が分かっていれば種類の名前とアイコンにする(⑩)
              const kind = reason === "needs-action" ? item.needsAction : null
              const Icon = kind ? NEEDS_ACTION_ICON[kind.kind] : ReasonIcon
              return (
                <Badge key={reason} variant="outline" data-testid={kind ? `needs-action-${kind.kind}` : undefined}>
                  <Icon style={{ color }} aria-hidden />
                  {kind ? NEEDS_ACTION_KIND_LABEL[kind.kind] : DECISION_REASON_LABEL[reason]}
                  {kind?.estimated && <span className="font-normal text-muted-foreground">（推定）</span>}
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
          {item.needsAction && (
            <p className="text-xs text-muted-foreground" data-testid="needs-action-source">
              分けた手がかり：{needsActionSourceLabel(item.needsAction.source, item.needsAction.buttons)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">最後の活動: {formatAgo(item.lastActivityAt)}</p>
        </div>
        <OpenSessionButton sessionId={item.id} className="justify-self-start md:justify-self-end" />
      </div>
    </div>
  )
}

/** C. あなたの対応待ち。許可待ち → 承認待ち → 判断待ち → 送信上限で停止 → エラー → 届かなかった送信 の順 */
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
        title="あなたの対応待ち"
        count={data.items.length}
        description="全グループ（グループ外を含む）のうち、要対応（許可待ち・承認待ち・判断待ち）・送信上限で停止中・エラー・届かなかった送信があるセッション。すぐ押せるものから、この順に並べ、同じ区分の中では、最後の活動が古いものを先に出します。待機（次の連絡を待っているだけ）は入れません。"
      />
      {data.items.length === 0 ? (
        <EmptyNote>対応を待っているセッションはありません。</EmptyNote>
      ) : (
        <LimitedList
          items={data.items}
          keyOf={(i) => i.id}
          label="対応待ちのセッション"
          renderItem={(item) => <DecisionRow item={item} onSelect={onSelect} />}
        />
      )}
    </section>
  )
}
