"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { DiagnosisComparison, SessionDiagnosis, SessionHealthReport } from "@/lib/sessionDiagnostics"
import { STATUS_TOKENS, StatusBadge } from "./statusToken"

interface SessionHealthPanelProps {
  report: SessionHealthReport
}

/** 他セッションとの差を「いつもの◯倍」「いつもより◯ポイント高い」の形で言い換える */
function comparisonText(c: DiagnosisComparison): string {
  const { current, median, sampleSize, higherIsBetter } = c
  const digits = Number.isInteger(median) && Number.isInteger(current) ? 0 : 1
  const base = `他${sampleSize}セッションの中央値 ${median.toFixed(digits)}`

  if (Math.abs(current - median) < 0.05) return `${base} と同水準`

  const isWorse = higherIsBetter ? current < median : current > median
  const direction = current > median ? "多い" : "少ない"
  // 中央値が0のときは倍率が無限大になるため、差分で表現する
  const magnitude =
    median > 0 ? `${(current / median).toFixed(1)}倍` : `${Math.abs(current - median).toFixed(digits)}の差で`

  return `${base} に対し ${magnitude}${direction}（${isWorse ? "いつもより悪い" : "いつもより良い"}）`
}

function DiagnosisRow({ diagnosis }: { diagnosis: SessionDiagnosis }) {
  const [expanded, setExpanded] = useState(false)
  const token = STATUS_TOKENS[diagnosis.severity]

  return (
    <div className={cn("overflow-hidden rounded-md border", token.surfaceClass)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 p-3 text-left"
      >
        <span className={cn("h-8 w-1 shrink-0 rounded-full", token.railClass)} aria-hidden />
        <token.Icon className="size-4 shrink-0" style={{ color: token.color }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium">{diagnosis.title}</span>
            <span className="text-xs text-muted-foreground">{token.label}</span>
          </span>
          <span className="mt-0.5 block truncate text-sm tabular-nums text-muted-foreground">
            {diagnosis.value}
          </span>
        </span>
        <ChevronRight
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="space-y-2 border-t px-3 py-3 pl-6">
          <p className="text-sm leading-relaxed">{diagnosis.meaning}</p>
          {diagnosis.action && (
            <div className="rounded-md border bg-background p-2.5">
              <p className="text-xs font-medium text-muted-foreground">次のアクション</p>
              <p className="mt-1 text-sm leading-relaxed">{diagnosis.action}</p>
            </div>
          )}
          {diagnosis.comparison && (
            <p className="text-xs text-muted-foreground">
              比較：{comparisonText(diagnosis.comparison)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">判定基準：{diagnosis.criteria}</p>
        </div>
      )}
    </div>
  )
}

/**
 * 生の数値だけでは判断できないため、8つの観点それぞれに「良好/注意/要対処」と
 * 次のアクションを添えて提示する。数字そのものより「何をすべきか」を先に読ませることを優先し、
 * 総合判定と対処案を最上部に置き、個別の根拠は展開して読む構成にしている。
 */
export function SessionHealthPanel({ report }: SessionHealthPanelProps) {
  const token = STATUS_TOKENS[report.overall]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          このセッションの診断
          <StatusBadge severity={report.overall} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={cn("flex items-start gap-3 rounded-md p-3", token.surfaceClass)}>
          <token.Icon className="mt-0.5 size-5 shrink-0" style={{ color: token.color }} aria-hidden />
          <p className="text-sm leading-relaxed">{report.headline}</p>
        </div>

        {report.topActions.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">今すぐ効く対処</h3>
            <ol className="space-y-1.5">
              {report.topActions.map((action, idx) => (
                <li key={idx} className="flex gap-2 rounded-md border bg-background p-2.5 text-sm leading-relaxed">
                  <span className="shrink-0 font-medium tabular-nums text-muted-foreground">{idx + 1}.</span>
                  <span className="min-w-0">{action}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">観点別の診断（クリックで根拠と対処を表示）</h3>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {report.diagnoses.map((d) => (
              <DiagnosisRow key={d.id} diagnosis={d} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
