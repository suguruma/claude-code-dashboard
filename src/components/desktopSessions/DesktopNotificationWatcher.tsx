"use client"

import { useCallback, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useDesktopNotifySettings } from "@/hooks/useDesktopNotifySettings"
import { useDesktopSessions } from "@/hooks/useDesktopSessions"
import { createNotifyTracker, planNotifications } from "@/lib/desktopNotifications"
import { showDesktopNotification } from "@/lib/desktopNotify"

/**
 * 要対応のデスクトップ通知の監視。アプリのどの画面を開いていても動くよう、AppShellに置く。
 * 通知がオフのあいだは一覧を取得しない。オンにした直後・起動直後の最初の取得は基準を取るだけで、
 * すでに要対応だったセッションは通知しない。
 */
export function DesktopNotificationWatcher() {
  const router = useRouter()
  const { enabled } = useDesktopNotifySettings()
  const { data } = useDesktopSessions(enabled)
  const tracker = useRef(createNotifyTracker())

  const openSession = useCallback(
    (sessionId: string | null) => {
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

  return null
}
