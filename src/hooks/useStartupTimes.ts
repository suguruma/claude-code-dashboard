"use client"

import { useCallback, useSyncExternalStore } from "react"

/**
 * ホームの段階的な表示(⑫)で使う時刻の記録(読み込みを始めた・答えが来た・出し直した、など)。
 * 描画の中で時刻を取らず(描画を純粋に保つ)、エフェクトや押したときに記録して、描画はこの記録を読むだけにする。
 * 静的な HTML と最初の描画では、記録は空(= 読み込み中)。
 */
type Times = Readonly<Record<string, number>>

let times: Times = {}
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** key の時刻を記録する。force=false のときは、まだ無いときだけ記録する(最初の時刻を残す)。at を渡すと、今ではなくその時刻にする */
export function recordTime(key: string, force = false, at?: number): void {
  if (!force && times[key] !== undefined) return
  times = { ...times, [key]: at ?? Date.now() }
  emit()
}

/** 接頭辞が prefix の記録を消す(ホームを離れたとき) */
export function clearTimes(prefix: string): void {
  const next = Object.fromEntries(Object.entries(times).filter(([key]) => !key.startsWith(prefix)))
  if (Object.keys(next).length === Object.keys(times).length) return
  times = next
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const EMPTY: Times = {}

export function useStartupTimes(): Times {
  return useSyncExternalStore(
    subscribe,
    () => times,
    () => EMPTY
  )
}

/** active のあいだ、intervalMs ごとに進む今の時刻(ms)。止まっているあいだと静的な HTML では、最後の値(初めは 0) */
let tickNow = 0
export function useTicker(active: boolean, intervalMs = 250): number {
  const subscribeTick = useCallback(
    (listener: () => void) => {
      if (!active) return () => {}
      // 購読の直後に、React が今の値を読み直す
      tickNow = Date.now()
      const id = window.setInterval(() => {
        tickNow = Date.now()
        listener()
      }, intervalMs)
      return () => window.clearInterval(id)
    },
    [active, intervalMs]
  )
  return useSyncExternalStore(
    subscribeTick,
    () => tickNow,
    () => 0
  )
}

/**
 * 境目の時刻(deadlines)にだけ進む今の時刻(ms)。境目の間は進まないので、ホーム全体を毎秒描き直さない
 * (遅い PC で、描き直しが読み込みの邪魔をしないように)。静的な HTML と最初の描画では 0
 */
let boundaryNow = 0
export function useNowAt(deadlines: number[]): number {
  const key = deadlines.join(",")
  const subscribeBoundary = useCallback(
    (listener: () => void) => {
      const points = key ? key.split(",").map(Number) : []
      let id: number | undefined
      const schedule = () => {
        const t = Date.now()
        const future = points.filter((d) => d > t)
        if (future.length === 0) return
        id = window.setTimeout(() => {
          boundaryNow = Date.now()
          listener()
          schedule()
        }, Math.min(...future) - t + 20)
      }
      // 購読の直後に、React が今の値を読み直す(過ぎた境目は、ここで反映される)
      boundaryNow = Date.now()
      schedule()
      return () => window.clearTimeout(id)
    },
    [key]
  )
  return useSyncExternalStore(
    subscribeBoundary,
    () => boundaryNow,
    () => 0
  )
}
