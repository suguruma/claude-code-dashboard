"use client"

import { Database, Hourglass, Moon, Snowflake, TimerOff } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { CLEANUP_REASON_LABEL, describeResumeCost, formatDuration } from "@/lib/housekeepingFormat"
import type { CleanupCandidate, HousekeepingResponse } from "@/lib/housekeepingTypes"
import { formatTokens } from "./format"
import { EmptyNote, LimitedList, SectionHeading } from "./HousekeepingList"
import { OpenSessionButton } from "./Messaging"

function CacheBadge({ cache }: { cache: CleanupCandidate["cache"] }) {
  if (cache === "expired") {
    return (
      <Badge variant="outline" title="最後の応答から1時間以上たち、プロンプトキャッシュが切れています。再開すると、コンテキスト全体を書き直します">
        <TimerOff className="text-[var(--status-warning)]" aria-hidden />
        キャッシュ切れ
      </Badge>
    )
  }
  if (cache === "valid") {
    return (
      <Badge variant="outline" title="最後の応答から1時間未満で、プロンプトキャッシュが有効です。いま再開しても、書き直しは起きません">
        <Snowflake className="text-muted-foreground" aria-hidden />
        キャッシュ有効
      </Badge>
    )
  }
  return (
    <Badge variant="outline" title="最後の応答の時刻が分からないため、キャッシュが切れているか判断できません">
      <Hourglass className="text-muted-foreground" aria-hidden />
      キャッシュ不明
    </Badge>
  )
}

function CleanupRow({ item, onSelect }: { item: CleanupCandidate; onSelect: (id: string) => void }) {
  const cost = item.resumeCost ? describeResumeCost(item.resumeCost) : null
  return (
    <div className="rounded-lg border p-3 transition-colors hover:border-primary">
      <div className="grid gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {item.reasons.map((reason) => (
              <Badge key={reason} variant="secondary">
                {reason === "large" ? <Database aria-hidden /> : <Moon aria-hidden />}
                {CLEANUP_REASON_LABEL[reason]}
              </Badge>
            ))}
            <CacheBadge cache={item.cache} />
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

          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
            {item.model && <span>{item.model}</span>}
            <span>
              コンテキスト {formatTokens(item.contextTokens)}（{Math.round(item.contextRatio * 100)}%）
            </span>
            <span>最後の応答から {item.idleMs === null ? "—" : formatDuration(item.idleMs)}</span>
          </p>

          {cost && item.resumeCost && (
            <p className="text-sm">
              <span className="text-muted-foreground">再開で使う上限の目安: </span>
              <span className="font-medium tabular-nums">
                {cost.shares.length > 0 ? cost.shares.join("・") : "（割合は出せません）"}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {" "}
                （{cost.dollars}
                {item.resumeCost.priceUnregistered ? "。価格表に無いモデルのため、opus の価格で計算" : ""}）
              </span>
            </p>
          )}
          {item.suggestClear && (
            <p className="text-xs text-muted-foreground">使わないなら、再開せずに /clear か圧縮で整理するのが得です。</p>
          )}
        </div>
        <OpenSessionButton sessionId={item.id} className="justify-self-start md:justify-self-end" />
      </div>
    </div>
  )
}

/** A. コンテキスト整理の候補。再開コストの大きい順 */
export function HousekeepingCleanupList({
  data,
  onSelect,
}: {
  data: HousekeepingResponse["cleanup"]
  onSelect: (id: string) => void
}) {
  const ratio = Math.round(data.highContextRatio * 100)
  return (
    <section aria-labelledby="hk-cleanup" className="space-y-3">
      <SectionHeading
        id="hk-cleanup"
        title="コンテキスト整理の候補"
        count={data.items.length}
        description={`コンテキストの使用率が${ratio}%以上、または最後の応答から${data.idleMinutes}分以上たって${formatTokens(data.minIdleTokens)}以上のセッション（実行中・アーカイブ済みは除く）。再開コストの大きい順です。`}
      />
      {data.items.length === 0 ? (
        <EmptyNote>整理の候補はありません。</EmptyNote>
      ) : (
        <LimitedList
          items={data.items}
          keyOf={(i) => i.id}
          label="コンテキスト整理の候補"
          renderItem={(item) => <CleanupRow item={item} onSelect={onSelect} />}
        />
      )}
      {!data.calibrated.fiveHour && !data.calibrated.weekly && data.items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          利用上限の公式値の記録が足りず、上限に対する割合を出せないため、金額（API価格換算）だけを表示しています。
        </p>
      )}
    </section>
  )
}
