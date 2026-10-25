"use client"

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import {
  ALERT_LABEL,
  bandRange,
  hhmm,
  nearestPoint,
  stepTime,
  thresholdLine,
  valueOf,
  valueText,
  yMax,
  type Metric,
} from "@/lib/monitor/loadView"
import type { AlertBand, AlertKey, MonitorLoadResponse } from "@/lib/monitor/monitorTypes"

const PLOT_H = 190
const TOP_LANE = 24 // 警告の札の段(図の外)
const AXIS_H = 24 // 時刻の目盛り
const GAP_LANE = 24 // 狭い「記録なし」の札の段(図の外)
const LEFT = 52
const RIGHT = 52
/** 札を図の中に置ける最小の幅(px)。これより狭い帯・途切れの札は図の外の段に出す(A24) */
const LABEL_MIN_W = 120

interface Props {
  data: MonitorLoadResponse
  metric: Metric
  selected: number | null
  onSelect: (t: number) => void
}

/**
 * ［負荷］の推移の図(⑭ WC-3〜WC-5・WC-11・WC-12)。SVG で描く。
 * - しきい値の点線と札(数字は alert の行の title から)、警告の時間帯(斜線の塗り・両端の実線・札)、記録の途切れ(灰色・札「記録なし」)、選んだ時刻の縦線
 * - 図は role=slider：押す・なぞる・←→(前後の記録)・Shift+←→(10分)・Home／End で時刻を選ぶ(A25)
 * - 文字は 14px 以上。色だけに頼らず、札の文字と縁で示す(A12・A24)
 */
export function LoadChart({ data, metric, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const patternId = useId().replace(/:/g, "")
  const dragging = useRef(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => setWidth(Math.max(280, Math.floor(entries[0].contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { points, from, to } = data
  const plotW = Math.max(100, width - LEFT - RIGHT)
  const top = yMax(points, metric, data.memTotalMb)
  const x = (t: number) => LEFT + ((t - from) / Math.max(1, to - from)) * plotW
  const y = (v: number) => TOP_LANE + PLOT_H - (Math.min(v, top) / top) * PLOT_H
  const tFromX = (px: number) => from + ((px - LEFT) / plotW) * (to - from)

  // 線は途切れの所で切る
  const gapStarts = new Set(data.gaps.map((g) => g.start))
  const segments: string[] = []
  let cur = ""
  for (const p of points) {
    const v = valueOf(p, metric)
    if (v === null) continue
    cur += `${cur ? "L" : "M"}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`
    if (gapStarts.has(p.t)) {
      segments.push(cur)
      cur = ""
    }
  }
  if (cur) segments.push(cur)

  const threshold = thresholdLine(data.thresholds[metric], metric, data.memTotalMb)
  const selPoint = selected === null ? null : nearestPoint(points, selected)
  const selValue = selPoint ? valueOf(selPoint, metric) : null

  // 時刻の目盛り(範囲に合わせた間隔。文字が重ならない数に)
  const span = to - from
  const stepMin = span <= 2 * 3600_000 ? 15 : span <= 6 * 3600_000 ? 60 : 180
  const ticks: number[] = []
  const first = Math.ceil(from / (stepMin * 60_000)) * stepMin * 60_000
  for (let t = first; t <= to; t += stepMin * 60_000) ticks.push(t)
  const tickEvery = Math.max(1, Math.ceil((ticks.length * 56) / plotW))

  const yTicks = metric === "cpu" ? [0, 50, 100] : [0, top / 2, top]
  const yLabel = (v: number) => (metric === "cpu" ? `${v}%` : `${v.toFixed(v >= 10 ? 0 : 1)}GB`)

  const bands: Array<{ key: AlertKey; band: AlertBand }> = [
    ...data.alerts[metric].map((band) => ({ key: metric, band })),
  ]
  const totalH = TOP_LANE + PLOT_H + AXIS_H + GAP_LANE

  const pick = (clientX: number) => {
    const rect = wrapRef.current?.querySelector("svg")?.getBoundingClientRect()
    if (!rect) return
    const t = tFromX(((clientX - rect.left) / rect.width) * width)
    const p = nearestPoint(points, t)
    if (p) onSelect(p.t)
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pick(e.clientX)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) pick(e.clientX)
  }
  const onPointerUp = () => {
    dragging.current = false
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = stepTime(points, selPoint?.t ?? points[points.length - 1]?.t ?? 0, e.key, e.shiftKey)
    if (next !== null) {
      e.preventDefault()
      onSelect(next)
    }
  }

  return (
    <div
      ref={wrapRef}
      role="slider"
      tabIndex={0}
      aria-label={`${metric === "cpu" ? "CPU" : "メモリ"}の推移。時刻を選ぶ`}
      aria-valuemin={from}
      aria-valuemax={to}
      aria-valuenow={selPoint?.t ?? from}
      aria-valuetext={valueText(selPoint, metric)}
      className="touch-none rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      data-testid="load-chart"
    >
      <svg width="100%" height={totalH} viewBox={`0 0 ${width} ${totalH}`} aria-hidden className="block overflow-visible">
        <defs>
          <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="var(--status-critical)" strokeWidth="2.5" strokeOpacity="0.45" />
          </pattern>
        </defs>

        {/* 横の目盛り線 */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={LEFT} x2={LEFT + plotW} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            <text x={LEFT - 6} y={y(v) + 5} textAnchor="end" fontSize="14" fill="var(--muted-foreground)">
              {yLabel(v)}
            </text>
          </g>
        ))}

        {/* 記録の途切れ(灰色と札) */}
        {data.gaps.map((g) => {
          const x1 = Math.max(LEFT, x(g.start))
          const x2 = Math.min(LEFT + plotW, x(g.end))
          if (x2 <= x1) return null
          const wide = x2 - x1 >= LABEL_MIN_W * 0.6
          const cx = Math.min(Math.max((x1 + x2) / 2, LEFT + 36), LEFT + plotW - 36)
          return (
            <g key={`gap-${g.start}`} data-testid="load-gap">
              <rect x={x1} y={TOP_LANE} width={Math.max(1.5, x2 - x1)} height={PLOT_H} fill="var(--muted)" stroke="var(--muted-foreground)" strokeOpacity="0.35" strokeDasharray="3 3" />
              <text
                x={cx}
                y={wide ? TOP_LANE + PLOT_H / 2 : TOP_LANE + PLOT_H + AXIS_H + 17}
                textAnchor="middle"
                fontSize="14"
                fill="var(--muted-foreground)"
              >
                記録なし
              </text>
            </g>
          )
        })}

        {/* 警告の時間帯(斜線・両端の実線・札。狭いときは札を図の外の上の段に) */}
        {bands.map(({ key, band }) => {
          const x1 = Math.max(LEFT, x(band.start))
          const x2 = Math.min(LEFT + plotW, Math.max(x(band.end), x1 + 3))
          const label = `警告 ${bandRange(band)}`
          const cx = Math.min(Math.max((x1 + x2) / 2, LEFT + 60), LEFT + plotW - 60)
          return (
            <g key={`band-${key}-${band.start}`} data-testid="load-alert-band">
              <rect x={x1} y={TOP_LANE} width={x2 - x1} height={PLOT_H} fill={`url(#${patternId})`} />
              <line x1={x1} x2={x1} y1={TOP_LANE} y2={TOP_LANE + PLOT_H} stroke="var(--status-critical-text)" strokeWidth="2" />
              <line x1={x2} x2={x2} y1={TOP_LANE} y2={TOP_LANE + PLOT_H} stroke="var(--status-critical-text)" strokeWidth="2" />
              <text x={cx} y={16} textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--status-critical-text)">
                {label}
              </text>
              <title>{`${ALERT_LABEL[key]}の${label}`}</title>
            </g>
          )
        })}

        {/* しきい値の点線と札(数字は alert の行の title から) */}
        {threshold !== null && (
          <g data-testid="load-threshold">
            <line x1={LEFT} x2={LEFT + plotW} y1={y(threshold)} y2={y(threshold)} stroke="var(--status-critical-text)" strokeDasharray="6 4" strokeWidth="1.5" />
            <text x={LEFT + plotW + 6} y={y(threshold) + 5} fontSize="14" fill="var(--status-critical-text)">
              {`${data.thresholds[metric]}%`}
            </text>
          </g>
        )}

        {/* 線 */}
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />
        ))}

        {/* 時刻の目盛り */}
        <line x1={LEFT} x2={LEFT + plotW} y1={TOP_LANE + PLOT_H} y2={TOP_LANE + PLOT_H} stroke="var(--border)" />
        {ticks
          // 縦軸の札(0% など)と重ならないよう、左端に近い目盛りは書かない
          .filter((t, i) => i % tickEvery === 0 && x(t) - LEFT >= 24)
          .map((t) => (
            <text key={t} x={x(t)} y={TOP_LANE + PLOT_H + 18} textAnchor="middle" fontSize="14" fill="var(--muted-foreground)">
              {hhmm(t)}
            </text>
          ))}

        {/* 選んだ時刻の縦線と点 */}
        {selPoint && (
          <g data-testid="load-selected">
            <line x1={x(selPoint.t)} x2={x(selPoint.t)} y1={TOP_LANE} y2={TOP_LANE + PLOT_H} stroke="var(--foreground)" strokeWidth="1.5" />
            {selValue !== null && <circle cx={x(selPoint.t)} cy={y(selValue)} r="5" fill="var(--background)" stroke="var(--foreground)" strokeWidth="2" />}
          </g>
        )}
      </svg>
    </div>
  )
}
