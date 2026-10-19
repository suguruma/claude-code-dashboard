"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { HousekeepingResponse } from "@/lib/housekeepingTypes"
import { HousekeepingCleanupList } from "./HousekeepingCleanupList"
import { HousekeepingDecisionList } from "./HousekeepingDecisionList"
import { HousekeepingUnansweredList } from "./HousekeepingUnansweredList"

const SUMMARY: { key: keyof HousekeepingResponse["counts"]; label: string; href: string }[] = [
  { key: "decisions", label: "あなたの対応待ち", href: "#hk-decisions" },
  { key: "unanswered", label: "返事の来ていない指示", href: "#hk-unanswered" },
  { key: "cleanup", label: "コンテキスト整理の候補", href: "#hk-cleanup" },
]

/** 整理ページの本体: 概要(3つの節の件数)と、あなたの対応待ち・返事の来ていない指示・コンテキスト整理の候補。読み取り専用 */
export function HousekeepingView({ data, onSelect }: { data: HousekeepingResponse; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-8">
      {data.warnings.map((warning) => (
        <Alert key={warning}>
          <AlertTitle>お知らせ</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      <nav aria-label="概要" className="grid gap-3 sm:grid-cols-3">
        {SUMMARY.map(({ key, label, href }) => (
          <a key={key} href={href} className="rounded-lg border p-3 transition-colors hover:border-primary">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold tabular-nums">
              {data.counts[key]}
              <span className="ml-1 text-sm font-normal text-muted-foreground">件</span>
            </div>
          </a>
        ))}
      </nav>

      {/* 判断が要るものを先頭に、次に返事の来ていない指示、最後に整理の候補 */}
      <HousekeepingDecisionList data={data.decisions} onSelect={onSelect} />
      <HousekeepingUnansweredList data={data.unanswered} onSelect={onSelect} />
      <HousekeepingCleanupList data={data.cleanup} onSelect={onSelect} />

      <p className="text-xs text-muted-foreground">{data.note}</p>
    </div>
  )
}
