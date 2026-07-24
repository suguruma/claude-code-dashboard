"use client"

import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

interface ToolOutputSizeChartProps {
  charsByName: Record<string, number>
}

/**
 * ツール名ごとの出力合計文字数（本文は保持せず文字数のみ）を表示する。
 * 呼び出し回数は少なくても1回の出力が巨大なツールほど、コンテキスト消費への寄与が大きい。
 */
export function ToolOutputSizeChart({ charsByName }: ToolOutputSizeChartProps) {
  const data = useMemo(
    () =>
      Object.entries(charsByName)
        .filter(([, chars]) => chars > 0)
        .map(([name, chars]) => ({ name, 出力文字数: chars }))
        .sort((a, b) => b.出力文字数 - a.出力文字数)
        .slice(0, 12),
    [charsByName]
  )

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">ツール出力データがありません。</p>
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
            formatter={(value) => (typeof value === "number" ? value.toLocaleString() : value)}
          />
          <Bar dataKey="出力文字数" fill="var(--chart-5)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
