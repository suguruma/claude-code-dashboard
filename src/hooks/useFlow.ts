"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { FlowResponse } from "@/lib/flowTypes"

const POLL_VISIBLE_MS = 5_000
/** 非表示のタブでは更新間隔を延ばし、常時監視の負荷を抑える */
const POLL_HIDDEN_MS = 30_000

const interval = () => (typeof document !== "undefined" && document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)

/**
 * グループの組織図用の出来事(読み取り専用)。表示範囲(rangeMs)は、更新のたびに「いまから rangeMs 前」を since にして求める。
 * キーには範囲を含めるが、更新のたびには変えない(キャッシュを作り直さない)。
 */
export function useFlow(groupId: string | null, rangeMs: number) {
  const { data, error, isLoading } = useSWR<FlowResponse>(
    groupId ? ["desktop-sessions-flow", groupId, rangeMs] : null,
    ([, group, range]: [string, string, number]) =>
      fetcher<FlowResponse>(`/api/desktop-sessions/flow?group=${encodeURIComponent(group)}&since=${Date.now() - range}`),
    { refreshInterval: interval, refreshWhenHidden: true, keepPreviousData: true }
  )
  return { data: data ?? null, error, isLoading }
}
