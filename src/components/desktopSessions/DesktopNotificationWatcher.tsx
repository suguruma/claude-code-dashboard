"use client"

import { useCallback, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useDesktopNotifySettings } from "@/hooks/useDesktopNotifySettings"
import { useDesktopSessions } from "@/hooks/useDesktopSessions"
import { useMonitorAlerts } from "@/hooks/useMonitor"
import { useUsage } from "@/hooks/useUsage"
import { createNotifyTracker, planNotifications } from "@/lib/desktopNotifications"
import { showDesktopNotification } from "@/lib/desktopNotify"
import { createPcAlertNotifyTracker, PC_ALERT_HREF, PC_ALERT_TARGET } from "@/lib/monitor/pcAlertNotifications"
import { createUsageNotifyTracker } from "@/lib/usageNotifications"

/**
 * 要対応のデスクトップ通知の監視。アプリのどの画面を開いていても動くよう、AppShellに置く。
 * 通知がオフのあいだは一覧を取得しない。オンにした直後・起動直後の最初の取得は基準を取るだけで、
 * すでに要対応だったセッションは通知しない。
 * 同じ通知のスイッチで、利用上限(80%・95%を超えたとき)の通知も出す。窓の枠・しきい値ごとに1回だけ。
 * PC の警告(⑭。CPU・メモリの警告の帯が新しく始まったとき)も同じスイッチで出す。押すとリソースの［負荷］を開く。
 */
export function DesktopNotificationWatcher() {
  const router = useRouter()
  const { enabled } = useDesktopNotifySettings()
  const { data } = useDesktopSessions(enabled)
  const { data: usage } = useUsage(enabled)
  const tracker = useRef(createNotifyTracker())
  const usageTracker = useRef(createUsageNotifyTracker())
  const pcAlerts = useMonitorAlerts(enabled)
  const pcTracker = useRef(createPcAlertNotifyTracker())

  const openSession = useCallback(
    (sessionId: string | null) => {
      if (sessionId === PC_ALERT_TARGET) {
        router.push(PC_ALERT_HREF)
        return
      }
      router.push(sessionId ? `/desktop-sessions?session=${encodeURIComponent(sessionId)}` : "/desktop-sessions")
    },
    [router]
  )

  // 配布exe: 通知をクリックされたら、メインプロセスがウィンドウを前面に出し、対象のセッションIDを渡してくる
  useEffect(() => {
    if (!enabled) return
    return window.electronAPI?.onNotificationOpen?.(openSession)
  }, [enabled, openSession])

  useEffect(() => {
    if (!enabled) {
      tracker.current.reset()
      return
    }
    if (!data) return
    for (const item of planNotifications(tracker.current.update(data.sessions))) {
      void showDesktopNotification(item, openSession)
    }
  }, [enabled, data, openSession])

  useEffect(() => {
    if (!enabled) {
      usageTracker.current.reset()
      return
    }
    if (!usage) return
    for (const item of usageTracker.current.update(usage)) {
      void showDesktopNotification(item, openSession)
    }
  }, [enabled, usage, openSession])

  useEffect(() => {
    if (!enabled) {
      pcTracker.current.reset()
      return
    }
    if (!pcAlerts) return
    for (const item of pcTracker.current.update(pcAlerts)) {
      void showDesktopNotification(item, openSession)
    }
  }, [enabled, pcAlerts, openSession])

  return null
}
