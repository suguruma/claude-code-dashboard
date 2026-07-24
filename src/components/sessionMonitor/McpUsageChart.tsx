"use client"

import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

interface McpUsageChartProps {
  countsByServer: Record<string, number>
}

/** MCPサーバー識別子（`mcp__<server>__<tool>`のserver部分）ごとの呼び出し回数を表示する */
export function McpUsageChart({ countsByServer }: McpUsageChartProps) {
  const data = useMemo(
    () =>
      Object.entries(countsByServer)
        .map(([server, count]) => ({ server, 呼び出し回数: count }))
        .sort((a, b) => b.呼び出し回数 - a.呼び出し回数)
        .slice(0, 12),
    [countsByServer]
  )

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">MCPツールの呼び出しはありません。</p>
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="server"
            width={140}
            tick={{ fontSize: 11 }}
            stroke="var(--muted-foreground)"
          />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="呼び出し回数" fill="var(--chart-4)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
