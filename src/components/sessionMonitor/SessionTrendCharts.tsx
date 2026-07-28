"use client"

import { useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TrendPoint, TrendSeries } from "@/lib/sessionDiagnostics"
import { ChartFrame } from "./ChartFrame"

interface SessionTrendChartsProps {
  trends: TrendSeries[]
}

/** 横軸が潰れて読めなくなるため、比較に使うのは直近この件数まで（時系列順は維持する） */
const MAX_POINTS = 20

function formatValue(value: number, unit: string): string {
  if (unit === "文字") {
    return value >= 10000 ? `${(value / 10000).toFixed(1)}万` : Math.round(value).toLocaleString("ja-JP")
  }
  if (unit === "%") return `${value.toFixed(0)}%`
  if (unit === "回") return String(Math.round(value))
  return value.toFixed(1)
}

/**
 * 選択中セッションにだけ値を直接表示する。
 * 全点に数値を出すと読まれないため、「今見ている1点」だけを直接ラベルし、
 * 残りは軸とツールチップに任せる。
 */
interface LabelRenderProps {
  x?: string | number
  y?: string | number
  width?: string | number
  index?: number
}

function CurrentValueLabel({
  x,
  y,
  width,
  index = 0,
  points,
  unit,
}: LabelRenderProps & { points: TrendPoint[]; unit: string }) {
  const point = points[index]
  if (!point?.isCurrent) return null
  const cx = Number(x ?? 0) + Number(width ?? 0) / 2
  const cy = Number(y ?? 0) - 6
  return (
    <text
      x={cx}
      y={cy}
      textAnchor="middle"
      className="fill-foreground"
      style={{ fontSize: 11, fontWeight: 600 }}
    >
      {formatValue(point.value, unit)}
    </text>
  )
}

function TrendChart({ series }: { series: TrendSeries }) {
  const points = useMemo(() => series.points.slice(-MAX_POINTS), [series.points])

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">データがありません。</p>
  }

  const currentPoint = points.find((p) => p.isCurrent)
  const showThreshold =
    series.threshold !== null && points.some((p) => p.value >= series.threshold! * 0.5)

  return (
    <div className="space-y-1">
      {/* 単一系列のため凡例は置かず、見出しと注記で何のグラフかを示す */}
      <p className="text-xs text-muted-foreground">
        {currentPoint
          ? `選択中のセッション：${formatValue(currentPoint.value, series.unit)}${series.unit === "%" ? "" : series.unit}`
          : "選択中のセッションはこの指標の対象外です"}
      </p>
      <ChartFrame height={160}>
        {({ width, height }) => (
          <BarChart
            width={width}
            height={height}
            data={points}
            margin={{ top: 18, right: 8, left: 0, bottom: 4 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              stroke="var(--muted-foreground)"
              interval="preserveStartEnd"
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="var(--muted-foreground)"
              tickLine={false}
              width={44}
              tickFormatter={(v: number) => formatValue(v, series.unit)}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v) => [
                `${formatValue(Number(v), series.unit)}${series.unit === "%" ? "" : series.unit}`,
                series.title,
              ]}
              labelFormatter={(label, payload) => {
                const p = payload?.[0]?.payload as TrendPoint | undefined
                return p?.isCurrent ? `${String(label)}（選択中）` : String(label ?? "")
              }}
            />
            {showThreshold && series.threshold !== null && (
              <ReferenceLine
                y={series.threshold}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                label={{
                  value: `目安 ${formatValue(series.threshold, series.unit)}`,
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                }}
              />
            )}
            <Bar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {points.map((p) => (
                // 選択中の1本だけを前景色で強調し、残りは文脈として中間グレーに落とす
                <Cell
                  key={p.sessionId}
                  fill={p.isCurrent ? "var(--foreground)" : "var(--chart-2)"}
                  fillOpacity={p.isCurrent ? 1 : 0.45}
                />
              ))}
              <LabelList
                dataKey="value"
                content={(props) => (
                  <CurrentValueLabel {...props} points={points} unit={series.unit} />
                )}
              />
            </Bar>
          </BarChart>
        )}
      </ChartFrame>
    </div>
  )
}

function TrendTable({ trends }: { trends: TrendSeries[] }) {
  // 横断比較の元データ。色や位置に頼らず値を読めるようにするための表形式ビュー
  const sessions = useMemo(() => {
    const map = new Map<string, { label: string; isCurrent: boolean }>()
    for (const t of trends) {
      for (const p of t.points.slice(-MAX_POINTS)) {
        if (!map.has(p.sessionId)) map.set(p.sessionId, { label: p.label, isCurrent: p.isCurrent })
      }
    }
    return [...map.entries()].map(([sessionId, v]) => ({ sessionId, ...v }))
  }, [trends])

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-3 font-medium">開始日</th>
            {trends.map((t) => (
              <th key={t.id} className="py-2 pr-3 font-medium whitespace-nowrap">
                {t.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.sessionId} className="border-b last:border-0">
              <td className="py-1.5 pr-3 whitespace-nowrap">
                {s.label}
                {s.isCurrent && <span className="ml-1 text-xs text-muted-foreground">（選択中）</span>}
              </td>
              {trends.map((t) => {
                const p = t.points.find((x) => x.sessionId === s.sessionId)
                return (
                  <td key={t.id} className="py-1.5 pr-3 whitespace-nowrap">
                    {p ? `${formatValue(p.value, t.unit)}${t.unit === "%" ? "" : t.unit}` : "—"}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 「この数字は多いのか少ないのか」は単独では判断できないため、
 * 同じプロジェクトの過去セッションを時系列（古い順）で並べ、選択中のセッションだけを強調する。
 * 自分の過去の実績が基準線になり、いつもと違う挙動が一目で分かることを狙う。
 */
export function SessionTrendCharts({ trends }: SessionTrendChartsProps) {
  const [view, setView] = useState<"chart" | "table">("chart")
  const pointCount = Math.max(...trends.map((t) => t.points.length), 0)

  if (pointCount < 2) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">過去セッションとの比較</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            このプロジェクトのセッションが1件しかないため、比較できません。作業を重ねると
            「いつもと比べて多い/少ない」が判定できるようになります。
          </p>
        </CardContent>
      </Card>
    )
  }

  const truncated = pointCount > MAX_POINTS

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm">過去セッションとの比較</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            同じプロジェクトのセッションを古い順に並べています。濃い棒が選択中のセッションです
            {truncated && `（直近${MAX_POINTS}件を表示）`}。
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant={view === "chart" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("chart")}
          >
            グラフ
          </Button>
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("table")}
          >
            表
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {view === "chart" ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {trends.map((t) => (
              <div key={t.id} className="min-w-0 space-y-1">
                <h3 className="text-sm font-medium">
                  {t.title}
                  {t.higherIsBetter !== null && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      （{t.higherIsBetter ? "高い" : "低い"}ほど良い）
                    </span>
                  )}
                </h3>
                <TrendChart series={t} />
              </div>
            ))}
          </div>
        ) : (
          <TrendTable trends={trends} />
        )}
      </CardContent>
    </Card>
  )
}
