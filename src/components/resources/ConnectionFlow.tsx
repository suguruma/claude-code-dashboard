"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { buildFlow, flowKeyframes, lapMs, shouldAnimate, type FlowModel } from "@/lib/monitor/connectionFlow"
import { hhmm, pct, type Metric } from "@/lib/monitor/loadView"
import type { MonitorSnapshotResponse } from "@/lib/monitor/monitorTypes"

const ROW_H = 32
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)"

function subscribeReduced(listener: () => void) {
  const q = window.matchMedia(REDUCED_QUERY)
  q.addEventListener("change", listener)
  return () => q.removeEventListener("change", listener)
}

function subscribeHidden(listener: () => void) {
  document.addEventListener("visibilitychange", listener)
  return () => document.removeEventListener("visibilitychange", listener)
}

/**
 * つながりの図「どこに CPU を使っているか」(⑭ WC-13)。左にセッションの点(名前と %)、右に PC 全体の点。
 * 線の太さと、線を流れる粒の数・速さが、PC 全体に対する割合。セッションの外は点線。数は必ず文字でも出す。
 * 粒は、線の上の位置を図を作るときに1度だけ計算し、transform のアニメーションにして画面の合成の側で動かす(⑮ OR-6)。
 * 描くたびに SVG を書き換えないので、描画のスレッドは粒のために働かない。動きを減らす設定・［動きを止める］・窓が隠れている・
 * 図が画面の外のときは粒を消す(A21)。
 */
export function ConnectionFlow({ snap, metric }: { snap: MonitorSnapshotResponse; metric: Metric }) {
  const model = buildFlow(snap, metric)
  const [paused, setPaused] = useState(false)
  const reducedMotion = useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED_QUERY).matches, () => false)
  const hidden = useSyncExternalStore(subscribeHidden, () => document.hidden, () => false)
  const [onScreen, setOnScreen] = useState(true)
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(240)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => setWidth(Math.max(80, Math.floor(entries[0].contentRect.width))))
    ro.observe(el)
    const io = new IntersectionObserver((entries) => setOnScreen(entries[0].isIntersecting))
    io.observe(el)
    return () => {
      ro.disconnect()
      io.disconnect()
    }
  }, [])

  if (!model) return null
  const animate = shouldAnimate({ reducedMotion, paused, hidden, onScreen })
  const what = metric === "cpu" ? "CPU" : "メモリ"
  const h = Math.max(1, model.nodes.length) * ROW_H

  return (
    <section className="space-y-3 rounded-xl p-4 ring-1 ring-foreground/10" aria-labelledby="flow-title" data-testid="load-flow">
      <div className="flex flex-wrap items-center gap-x-3">
        <h2 id="flow-title" className="font-semibold">
          どこに {what} を使っているか（{snap.t === null ? "" : hhmm(snap.t)}）
        </h2>
        {!reducedMotion && (
          <button
            type="button"
            className="ml-auto inline-flex min-h-9 items-center text-sm text-primary hover:underline"
            aria-pressed={paused}
            onClick={() => setPaused((v) => !v)}
          >
            {paused ? "動かす" : "動きを止める"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,15rem)_minmax(5rem,1fr)_minmax(0,11rem)] items-center gap-x-2">
        <ul className="text-sm" aria-label="セッション">
          {model.nodes.map((n) => (
            <li key={n.key} className="flex h-8 items-center justify-end gap-2" data-kind={n.kind}>
              <span className={`truncate ${n.kind === "session" ? "" : "text-muted-foreground"}`} title={n.label}>
                {n.label}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{pct(n.share)}</span>
            </li>
          ))}
        </ul>
        <div ref={boxRef} className="relative h-full" style={{ height: h }}>
          <FlowLines model={model} width={width} height={h} animate={animate} />
        </div>
        <div className="text-sm">
          <p className="font-semibold">
            PC 全体の {what} {pct(model.total)}
          </p>
          <p className="text-muted-foreground [word-break:auto-phrase]" data-testid="flow-unexplained">
            説明できない分 {pct(model.unexplained)}（システムなど）
          </p>
        </div>
      </div>
      {reducedMotion && <p className="text-sm text-muted-foreground">動きを減らす設定のため、粒を出さず、線の太さと数だけを出しています。</p>}
    </section>
  )
}

function FlowLines({ model, width, height, animate }: { model: FlowModel; width: number; height: number; animate: boolean }) {
  const particlesRef = useRef<HTMLDivElement>(null)
  const pathsRef = useRef<Map<string, SVGPathElement>>(new Map())
  const rightY = height / 2

  // 粒を動かす。数(線の太さと粒の数)が変わったときと、動かす・止めるが変わったときだけ作り直す
  const signature = model.nodes.map((n) => `${n.key}:${n.particles}`).join("|") + `|${model.speed}|${width}|${height}`
  useEffect(() => {
    const layer = particlesRef.current
    if (!layer) return
    layer.replaceChildren()
    if (!animate) return
    const lap = lapMs(model.speed)
    const animations: Animation[] = []
    for (const n of model.nodes) {
      const path = pathsRef.current.get(n.key)
      if (!path || n.particles === 0) continue
      const len = path.getTotalLength()
      const keyframes = flowKeyframes((at) => path.getPointAtLength(at * len))
      for (let i = 0; i < n.particles; i++) {
        const el = document.createElement("span")
        el.className = "flow-particle"
        el.dataset.testid = "flow-particle"
        layer.appendChild(el)
        // 粒どうしの間隔は、1周の中の開始の位置をずらして作る(負の delay で途中から始める)
        animations.push(el.animate(keyframes, { duration: lap, iterations: Infinity, delay: -(i / n.particles) * lap, easing: "linear" }))
      }
    }
    return () => {
      for (const a of animations) a.cancel()
      layer.replaceChildren()
    }
    // signature に数と大きさをまとめている
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, animate])

  return (
    <>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="block overflow-visible">
        {model.nodes.map((n, i) => {
          const y = i * ROW_H + ROW_H / 2
          const d = `M0,${y} C${width * 0.5},${y} ${width * 0.5},${rightY} ${width},${rightY}`
          return (
            <path
              key={n.key}
              ref={(el) => {
                if (el) pathsRef.current.set(n.key, el)
                else pathsRef.current.delete(n.key)
              }}
              d={d}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeOpacity={n.kind === "session" ? 0.55 : 0.4}
              strokeWidth={n.width}
              strokeDasharray={n.kind === "outside" ? "4 4" : undefined}
              strokeLinecap="round"
              data-testid="flow-line"
            />
          )
        })}
        <circle cx={width} cy={rightY} r="7" fill="var(--foreground)" />
      </svg>
      <div ref={particlesRef} aria-hidden className="pointer-events-none absolute inset-0" />
    </>
  )
}
