"use client"

import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

interface ToolCallChartProps {
  countsByName: Record<string, number>
  errorCountsByName: Record<string, number>
}

export function ToolCallChart({ countsByName, errorCountsByName }: ToolCallChartProps) {
  const data = useMemo(
    () =>
      Object.entries(countsByName)
        .map(([name, count]) => ({
          name,
          呼び出し回数: count,
          エラー回数: errorCountsByName[name] ?? 0,
        }))
        .sort((a, b) => b.呼び出し回数 - a.呼び出し回数)
        .slice(0, 12),
    [countsByName, errorCountsByName]
  )

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">ツール呼び出しがありません。</p>
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
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
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="呼び出し回数" fill="var(--chart-1)" />
          <Bar dataKey="エラー回数" fill="var(--destructive)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
