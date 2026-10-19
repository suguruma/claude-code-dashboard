"use client"

import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { useHousekeeping } from "@/hooks/useHousekeeping"
import { CLEANUP_REASON_LABEL, DECISION_REASON_LABEL, UNANSWERED_KIND_LABEL, formatDuration } from "@/lib/housekeepingFormat"
import { PHONE_SWR_OPTIONS, decisionWaitLabel } from "@/lib/phoneView"
import { cn } from "@/lib/utils"
import { formatAgo } from "@/components/desktopSessions/format"
import { CARD, META, PhoneNotice, TAPPABLE } from "./parts"
import { openSession } from "./sessionHash"

/**
 * スマホの整理(⑪-2)。3つの区分を、件数つきの見出しにし、押して開く(Q20)。最初は「あなたの対応待ち」だけを開く。
 * 1件の行は高さ56px以上で、押すとそのセッションの詳細を開く。値は PC の整理ページと同じ API。
 */
export function PhoneHousekeeping() {
  const { data, error, isLoading } = useHousekeeping(PHONE_SWR_OPTIONS)

  return (
    <div className="space-y-3">
      <PhoneNotice error={error} isLoading={isLoading} hasData={data !== null} />

      {data && (
        <>
          <Section title="あなたの対応待ち" count={data.decisions.items.length} defaultOpen testId="phone-hk-decisions">
            {data.decisions.items.map((d) => (
              <Item
                key={d.id}
                onClick={() => openSession(d.id)}
                title={d.title}
                lead={decisionWaitLabel(d)}
                meta={[
                  d.groupName,
                  d.reasons.length > 1 ? d.reasons.slice(1).map((r) => DECISION_REASON_LABEL[r]).join("・") : null,
                  formatAgo(d.lastActivityAt),
                ]}
                excerpt={d.excerpt}
              />
            ))}
          </Section>

          <Section title="返事の来ていない指示" count={data.unanswered.items.length} testId="phone-hk-unanswered">
            {data.unanswered.items.map((u) => (
              <Item
                key={`${u.fromId}-${u.toId}-${u.sentAt}`}
                onClick={() => openSession(u.toId)}
                title={u.toTitle}
                lead={UNANSWERED_KIND_LABEL[u.kind]}
                meta={[`${u.fromTitle} から`, u.groupName, `${formatDuration(u.ageMs)}前`, u.working ? "作業中" : null]}
                excerpt={u.summary || null}
              />
            ))}
          </Section>

          <Section title="コンテキスト整理の候補" count={data.cleanup.items.length} testId="phone-hk-cleanup">
            {data.cleanup.items.map((c) => (
              <Item
                key={c.id}
                onClick={() => openSession(c.id)}
                title={c.title}
                lead={c.reasons.map((r) => CLEANUP_REASON_LABEL[r]).join("・")}
                meta={[
                  c.groupName,
                  `コンテキスト ${Math.round(c.contextRatio * 100)}%`,
                  c.idleMs !== null ? `${formatDuration(c.idleMs)}止まっている` : null,
                  c.suggestClear ? "使わないなら /clear か圧縮" : null,
                ]}
                excerpt={null}
              />
            ))}
          </Section>

          <p className={META}>{data.note}</p>
        </>
      )}
    </div>
  )
}

function Section({
  title,
  count,
  defaultOpen = false,
  testId,
  children,
}: {
  title: string
  count: number
  defaultOpen?: boolean
  testId: string
  children: ReactNode
}) {
  return (
    <details className={cn(CARD, "group overflow-hidden")} open={defaultOpen} data-testid={testId}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-4 select-none active:bg-muted">
        <span className="flex-1 text-base font-semibold">{title}</span>
        <span
          className={cn("text-xl font-semibold tabular-nums", count > 0 && testId === "phone-hk-decisions" && "text-[var(--status-critical-text)]")}
        >
          {count}件
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      {count === 0 ? (
        <p className={cn(META, "border-t px-4 py-3")}>いまはありません。</p>
      ) : (
        <ul className="divide-y border-t">{children}</ul>
      )}
    </details>
  )
}

function Item({
  onClick,
  title,
  lead,
  meta,
  excerpt,
}: {
  onClick: () => void
  title: string
  lead: string
  meta: Array<string | null>
  excerpt: string | null
}) {
  const metaText = meta.filter((m): m is string => !!m).join("・")
  return (
    <li>
      <button type="button" onClick={onClick} className={cn(TAPPABLE, "flex min-h-14 items-center gap-2 px-4 py-2.5")}>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium [overflow-wrap:anywhere]">{title}</span>
          <span className={cn(META, "block")}>
            <span className="font-medium text-foreground">{lead}</span>
            {metaText && `・${metaText}`}
          </span>
          {excerpt && <span className={cn(META, "line-clamp-2 block [overflow-wrap:anywhere]")}>{excerpt}</span>}
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  )
}
