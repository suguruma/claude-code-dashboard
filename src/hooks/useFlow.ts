"use client"

import { useCallback } from "react"
import useSWR from "swr"
import { abortInflight, fetchLatest } from "@/lib/latestFetch"
import type { FlowResponse } from "@/lib/flowTypes"

const POLL_VISIBLE_MS = 5_000
/** 非表示のタブでは更新間隔を延ばし、常時監視の負荷を抑える */
const POLL_HIDDEN_MS = 30_000

const interval = () => (typeof document !== "undefined" && document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)

/**
 * グループの組織図用の出来事(読み取り専用)。表示範囲(rangeMs)は、更新のたびに「いまから rangeMs 前」を since にして求める。
 * キーには範囲を含めるが、更新のたびには変えない(キャッシュを作り直さない)。
 * retry: ［もう一度読み込む］。待っている要求を止めてから出し直す(⑫ ST-8。サーバーの側も同じ計算を共有する)
 */
export function useFlow(groupId: string | null, rangeMs: number) {
  const { data, error, isLoading, mutate } = useSWR<FlowResponse>(
    groupId ? ["desktop-sessions-flow", groupId, rangeMs] : null,
    ([, group, range]: [string, string, number]) =>
      fetchLatest<FlowResponse>(
        flowKey(group, range),
        `/api/desktop-sessions/flow?group=${encodeURIComponent(group)}&since=${Date.now() - range}`
      ),
    { refreshInterval: interval, refreshWhenHidden: true, keepPreviousData: true }
  )
  const retry = useCallback(() => {
    if (groupId) abortInflight(flowKey(groupId, rangeMs))
    return mutate()
  }, [mutate, groupId, rangeMs])
  return { data: data ?? null, error, isLoading, retry }
}

function flowKey(group: string, rangeMs: number): string {
  return `flow|${group}|${rangeMs}`
}
