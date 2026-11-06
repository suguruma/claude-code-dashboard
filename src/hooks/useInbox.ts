"use client"

import { useCallback, useMemo } from "react"
import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import { buildInbox, isUnread, type InboxItem, type InboxReadData } from "@/lib/inbox"
import { buildMarks } from "@/lib/statusMark"
import { useDesktopSessions } from "./useDesktopSessions"
import { useMonitorAlerts } from "./useMonitor"
import { useUsage } from "./useUsage"

const READ_KEY = "/api/inbox-read"
/** 鐘の取り方：30秒ごと・見えないときは読まない(⑮ A15。セッション系のページは、ページの側が5秒ごとに取る) */
const BELL_SWR = { refreshInterval: 30_000, refreshWhenHidden: false }

export interface InboxView {
  items: InboxItem[]
  unread: number
  isUnread: (item: InboxItem) => boolean
  /** 既読にする(unread: true なら未読に戻す)。画面は先に変え、書けなかったら読み直す */
  mark: (items: InboxItem[], unread?: boolean) => Promise<void>
  ready: boolean
  error: boolean
  /** 一覧を作った時刻(「〜前」の基準) */
  now: number
}

/** 知らせの鐘(⑮ OR-4)。セッションの一覧・利用上限・PC の警告の記録から知らせを組み立て、既読の記録と合わせる */
export function useInbox(): InboxView {
  const { data: list, error: listError } = useDesktopSessions(true, BELL_SWR)
  const { data: usage } = useUsage(true, { refreshWhenHidden: false })
  const alerts = useMonitorAlerts()
  const { data: readData, mutate } = useSWR<InboxReadData>(READ_KEY, fetcher, { revalidateOnFocus: true, refreshWhenHidden: false })

  const items = useMemo(
    () => (list ? buildInbox({ sessions: list.sessions, marks: buildMarks(list.sessions, list.generatedAt), alerts, usage, now: list.generatedAt }) : []),
    [list, alerts, usage]
  )
  const reads = useMemo(() => readData?.reads ?? [], [readData])
  const check = useCallback((item: InboxItem) => isUnread(item, reads), [reads])

  const mark = useCallback(
    async (targets: InboxItem[], unread = false) => {
      if (targets.length === 0) return
      const body = { items: targets.map((t) => ({ target: t.target, kind: t.kind })), ...(unread ? { unread: true } : {}) }
      try {
        const res = await fetch(READ_KEY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        if (!res.ok) throw new Error(String(res.status))
        await mutate((await res.json()) as InboxReadData, { revalidate: false })
      } catch {
        await mutate()
      }
    },
    [mutate]
  )

  return {
    items,
    unread: items.filter(check).length,
    isUnread: check,
    mark,
    ready: list !== null,
    error: !list && !!listError,
    now: list?.generatedAt ?? 0,
  }
}
