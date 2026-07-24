"use client"

import { useMemo } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { CompactionEvent, TokenPoint } from "@/lib/types"

interface TokenUsageChartProps {
  tokenPoints: TokenPoint[]
  compactions: CompactionEvent[]
}

/**
 * ターンごとのコンテキストサイズ（input + cache_read + cache_creation、そのターンで
 * Claudeが実際に読み込んだトークンの近似値）を積み上げ面グラフで表示する。
 * コンパクション発生ターンには縦線を引き「どこで記憶がリセットされたか」を見えるようにする。
 */
export function TokenUsageChart({ tokenPoints, compactions }: TokenUsageChartProps) {
  const data = useMemo(
    () =>
      tokenPoints.map((p) => ({
        turnIndex: p.turnIndex,
        入力: p.inputTokens,
        キャッシュ読込: p.cacheReadTokens,
        キャッシュ新規作成: p.cacheCreationTokens,
        出力: p.outputTokens,
      })),
    [tokenPoints]
  )

  const compactionTurns = useMemo(() => {
    if (compactions.length === 0 || tokenPoints.length === 0) return []
    return compactions
      .map((c) => tokenPoints.findIndex((p) => p.timestamp >= c.timestamp))
      .filter((idx) => idx >= 0)
  }, [compactions, tokenPoints])

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">トークン消費データがありません。</p>
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="turnIndex" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="キャッシュ読込"
            stackId="1"
            stroke="var(--chart-2)"
            fill="var(--chart-2)"
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="キャッシュ新規作成"
            stackId="1"
            stroke="var(--chart-3)"
            fill="var(--chart-3)"
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="入力"
            stackId="1"
            stroke="var(--chart-1)"
            fill="var(--chart-1)"
            fillOpacity={0.6}
          />
          <Area
            type="monotone"
            dataKey="出力"
            stroke="var(--primary)"
            fill="var(--primary)"
            fillOpacity={0.3}
          />
          {compactionTurns.map((turnIndex) => (
            <ReferenceLine
              key={turnIndex}
              x={turnIndex}
              stroke="var(--destructive)"
              strokeDasharray="4 4"
              label={{ value: "コンパクション", fontSize: 10, fill: "var(--destructive)" }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
