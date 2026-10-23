"use client"

import { useSyncExternalStore } from "react"
import type { MarksView, StageMark } from "@/lib/homeStartup"

/**
 * ホームの段階の印(⑫ ST-9)を、ホームのページから上のバーへ渡すための小さな入れ物。
 * ホームが書き、上のバー(TopBar)が読む。ホームを離れたら空にする。
 */
export interface HomeStagesState {
  marks: StageMark[]
  view: MarksView
  /** 読み込みを始めた時刻(ms)。上のバーの秒は、印の部品がこれから数える */
  startedAt: number
  dismissFailure: () => void
}

let state: HomeStagesState | null = null
const listeners = new Set<() => void>()

export function publishHomeStages(next: HomeStagesState | null): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useHomeStages(): HomeStagesState | null {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => null
  )
}
