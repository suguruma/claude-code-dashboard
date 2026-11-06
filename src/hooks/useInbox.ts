"use client"

import { useCallback, useMemo } from "react"
import useSWR, { useSWRConfig } from "swr"
import { fetcher } from "@/lib/fetcher"
import { BASE_TARGET, bellCoversSinceBase, buildInbox, isUnread, viewBase, type InboxItem, type InboxKind, type InboxRead, type InboxReadData } from "@/lib/inbox"
import { buildMarks } from "@/lib/statusMark"
import { useDesktopSessions } from "./useDesktopSessions"
import { useMonitorAlerts } from "./useMonitor"
import { useUsage } from "./useUsage"

const READ_KEY = "/api/inbox-read"
/** 画面で使う基準の時刻(見る前の記録の値)。取りに行かず、鐘と看板で同じ値を使う */
const BASE_KEY = "inbox:view-base"
/** 鐘の取り方：30秒ごと・見えないときは読まない(⑮ A15。セッション系のページは、ページの側が5秒ごとに取る) */
const BELL_SWR = { refreshInterval: 30_000, refreshWhenHidden: false }

type ReadTarget = Pick<InboxRead, "target" | "kind">
const BASE_ITEM: ReadTarget = { target: BASE_TARGET, kind: "turn-end" }

export interface InboxView {
  items: InboxItem[]
  unread: number
  isUnread: (item: InboxItem) => boolean
  /** その対象・種類を、その時刻より後に見ていないか(看板の完了の列の「未読」) */
  unreadAt: (target: string, kind: InboxKind, at: number) => boolean
  /** 既読にする(unread: true なら未読に戻す)。画面は先に変え、書けなかったら読み直す */
  mark: (items: InboxItem[], unread?: boolean) => Promise<void>
  /** すべて既読にする。鐘に出ない24時間より前の物も既読にするため、基準の時刻も今にする */
  markAll: () => Promise<void>
  /**
   * 看板か鐘を見た(指示56 案1)。refresh(看板を開いたとき)なら、画面の基準を見る前の記録の値に決め直し、記録の基準の時刻を今にする。
   * 鐘を開いただけでは画面の基準を変えず、記録の基準は、鐘の見える範囲(24時間・20件)が前の基準まで届くときだけ今にする。
   * 記録がまだ読めていなければ何もせず false を返す
   */
  see: (refresh?: boolean) => Promise<boolean>
  /** 基準の時刻が決まった(see はこの後に呼ぶ) */
  baseReady: boolean
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
  const { mutate: setShared } = useSWRConfig()
  const { data: heldBase } = useSWR<number>(BASE_KEY, null)

  const items = useMemo(
    () => (list ? buildInbox({ sessions: list.sessions, marks: buildMarks(list.sessions, list.generatedAt), alerts, usage, now: list.generatedAt }) : []),
    [list, alerts, usage]
  )
  const reads = useMemo(() => readData?.reads ?? [], [readData])
  // 初めは記録の値をそのまま使い、見たとき(see)・すべて既読のときだけ、鐘と看板で共有する値を決め直す
  const base = heldBase ?? (readData && list ? viewBase(readData.reads, list.generatedAt) : null)
  const check = useCallback((item: InboxItem) => isUnread(item, reads, base), [reads, base])
  const unreadAt = useCallback((target: string, kind: InboxKind, at: number) => isUnread({ target, kind, at }, reads, base), [reads, base])

  const post = useCallback(
    async (targets: ReadTarget[], unread = false) => {
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
  const mark = useCallback((targets: InboxItem[], unread = false) => post(targets, unread), [post])

  const see = useCallback(
    async (refresh = false) => {
      if (!readData || !list) return false
      if (refresh) {
        await setShared(BASE_KEY, viewBase(readData.reads, list.generatedAt), { revalidate: false })
        await post([BASE_ITEM])
        return true
      }
      // 鐘：画面の基準は今の値のまま止める(記録が進んでも、開いている間の未読は変えない)
      if (heldBase === undefined && base !== null) await setShared(BASE_KEY, base, { revalidate: false })
      if (bellCoversSinceBase(readData.reads, items, list.generatedAt)) await post([BASE_ITEM])
      return true
    },
    [readData, list, items, heldBase, base, setShared, post]
  )

  const markAll = useCallback(async () => {
    // 画面の基準はサーバーの時刻(一覧を作った時刻)にそろえる
    await setShared(BASE_KEY, list?.generatedAt ?? Date.now(), { revalidate: false })
    await post([...items.filter(check), BASE_ITEM])
  }, [items, check, list, setShared, post])

  return {
    items,
    unread: items.filter(check).length,
    isUnread: check,
    unreadAt,
    mark,
    markAll,
    see,
    baseReady: base !== null,
    ready: list !== null,
    error: !list && !!listError,
    now: list?.generatedAt ?? 0,
  }
}
