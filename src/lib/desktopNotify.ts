import type { NotificationItem } from "./desktopNotifications"

/**
 * 要対応のデスクトップ通知を表示する(クライアント側)。外部のサービスは使わない。
 * - 配布exe: preload.js が公開する electronAPI 経由で、メインプロセスの Electron Notification を使う
 * - ブラウザ: Notification API を使う(許可が必要)
 */

export type NotifySupport = "electron" | "browser" | "unsupported"

export function notificationSupport(): NotifySupport {
  if (typeof window === "undefined") return "unsupported"
  if (window.electronAPI?.notify) return "electron"
  if (typeof Notification !== "undefined") return "browser"
  return "unsupported"
}

export type PermissionResult = "granted" | "denied" | "unsupported"

/** 通知を出せる状態にする。ブラウザでは許可を求める(ElectronはOSが表示できれば許可不要) */
export async function requestNotificationPermission(): Promise<PermissionResult> {
  const support = notificationSupport()
  if (support === "unsupported") return "unsupported"
  if (support === "electron") {
    return (await window.electronAPI!.notificationsSupported()) ? "granted" : "unsupported"
  }
  if (Notification.permission === "granted") return "granted"
  if (Notification.permission === "denied") return "denied"
  return (await Notification.requestPermission()) === "granted" ? "granted" : "denied"
}

/**
 * 通知を1件表示する。許可されていなければ何もしない。
 * クリックされたら onOpen(sessionId) を呼ぶ(まとめの通知は null で、一覧を開く)。
 */
export async function showDesktopNotification(
  item: NotificationItem,
  onOpen: (sessionId: string | null) => void
): Promise<void> {
  const support = notificationSupport()
  if (support === "electron") {
    // クリック時の動作(ウィンドウを前面に出す・対象のセッションを開く)は、メインプロセスが onNotificationOpen 経由で通知する
    await window.electronAPI!.notify({ title: item.title, body: item.body, sessionId: item.sessionId })
    return
  }
  if (support === "browser" && Notification.permission === "granted") {
    // 同じセッションの通知は tag で置き換え、積み重ならないようにする
    const notification = new Notification(item.title, { body: item.body, tag: item.sessionId ?? "desktop-sessions" })
    notification.onclick = () => {
      window.focus()
      onOpen(item.sessionId)
      notification.close()
    }
  }
}
