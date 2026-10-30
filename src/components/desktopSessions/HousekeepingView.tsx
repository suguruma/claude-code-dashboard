"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { HousekeepingResponse } from "@/lib/housekeepingTypes"
import { HousekeepingCleanupList } from "./HousekeepingCleanupList"
import { HousekeepingUnansweredList } from "./HousekeepingUnansweredList"

const SUMMARY: { key: keyof HousekeepingResponse["counts"]; label: string; href: string }[] = [
  { key: "unanswered", label: "返事の来ていない指示", href: "#hk-unanswered" },
  { key: "cleanup", label: "コンテキスト整理の候補", href: "#hk-cleanup" },
]

/**
 * 整理ページの本体: 概要(2つの節の件数)と、返事の来ていない指示・コンテキスト整理の候補。読み取り専用。
 * 次にやる判断(もとの「あなたの対応待ち」)は、ホームへ移した(⑬ の棚卸しの行21)。ここには件数とホームへの入口だけを出す
 */
export function HousekeepingView({ data, onSelect }: { data: HousekeepingResponse; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-8">
      {data.warnings.map((warning) => (
        <Alert key={warning}>
          <AlertTitle>お知らせ</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      <nav aria-label="概要" className="grid gap-3 sm:grid-cols-2">
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

      <p className="text-sm text-muted-foreground" data-testid="hk-decisions-link">
        次にやる判断（{data.counts.decisions}件）は{" "}
        <Link href="/#home-decisions" className="inline-flex items-center gap-1 text-primary hover:underline">
          ホーム <ArrowRight className="size-3.5" aria-hidden />
        </Link>{" "}
        で、急ぐ順に見ます。
      </p>

      {/* 返事の来ていない指示(催促の判断)、次に整理の候補 */}
      <HousekeepingUnansweredList data={data.unanswered} onSelect={onSelect} />
      <HousekeepingCleanupList data={data.cleanup} onSelect={onSelect} />

      <p className="text-xs text-muted-foreground">{data.note}</p>
    </div>
  )
}
