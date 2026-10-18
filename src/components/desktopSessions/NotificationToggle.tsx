"use client"

import { useState } from "react"
import { Bell } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useDesktopNotifySettings } from "@/hooks/useDesktopNotifySettings"
import { useMounted } from "@/hooks/useMounted"
import { notificationSupport, requestNotificationPermission, showDesktopNotification } from "@/lib/desktopNotify"

/** 要対応のデスクトップ通知のオン・オフ。初期値はオフで、オンにするときに通知の許可を確認する */
export function NotificationToggle() {
  const { enabled, isLoading, setEnabled } = useDesktopNotifySettings()
  const [busy, setBusy] = useState(false)
  // 通知の対応状況はブラウザ(window)でしか分からない。サーバー描画との食い違い(Hydration Mismatch)を避ける
  const mounted = useMounted()

  async function handleChange(next: boolean) {
    setBusy(true)
    try {
      if (next) {
        const permission = await requestNotificationPermission()
        if (permission === "denied") {
          toast.error("通知が許可されていません。ブラウザの設定で、このサイトの通知を許可してください")
          return
        }
        if (permission === "unsupported") {
          toast.error("この環境では通知を表示できません")
          return
        }
      }
      await setEnabled(next)
      toast.success(next ? "要対応になったセッションをデスクトップ通知します" : "デスクトップ通知をオフにしました")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "設定を保存できませんでした")
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    await showDesktopNotification(
      { sessionId: null, title: "Claude Code Dashboard", body: "通知のテストです。要対応のセッションが出るとこのように表示されます" },
      () => undefined
    )
  }

  const unsupported = mounted && notificationSupport() === "unsupported"

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Switch
        id="desktop-notify"
        checked={enabled}
        disabled={isLoading || busy || (unsupported && !enabled)}
        onCheckedChange={(checked) => void handleChange(checked)}
      />
      <Label htmlFor="desktop-notify" className="gap-1.5 text-sm text-muted-foreground">
        <Bell className="size-3.5" aria-hidden />
        要対応になったらデスクトップ通知する
      </Label>
      {enabled && (
        <Button variant="outline" size="sm" onClick={() => void sendTest()}>
          テスト通知
        </Button>
      )}
      <span className="text-xs text-muted-foreground">
        {unsupported
          ? "この環境では通知を表示できません。"
          : "新しく要対応になったときだけ通知します。外部のサービスは使いません（初期値はオフ）。"}
      </span>
    </div>
  )
}
