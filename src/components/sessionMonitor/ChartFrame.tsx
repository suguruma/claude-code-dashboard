"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

interface ChartFrameProps {
  /** プロット領域の高さ（px）。軸ラベルの帯を含めた値を渡す */
  height: number
  children: (size: { width: number; height: number }) => ReactNode
}

/**
 * Rechartsの`ResponsiveContainer`は初回マウント時に幅を0と計測したまま復帰しないことがあり、
 * その場合グラフが無言で空欄になる（実データで発生を確認済み）。
 * ここでは自前のResizeObserverでレイアウト確定後の実寸を取り、
 * チャートには常に確定済みのピクセル値を渡すことで、初回描画を保証する。
 */
export function ChartFrame({ height, children }: ChartFrameProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="w-full" style={{ height }}>
      {width > 0 ? children({ width, height }) : null}
    </div>
  )
}
