import type { NotificationItem } from "@/lib/desktopNotifications"
import { ALERT_LABEL, bandRange, pct } from "./loadView"
import type { MonitorAlertSummary } from "./monitorTypes"

/**
 * PC の警告の通知(⑭ WC-6・A30)。今の通知の仕組み(desktopNotifications の NotificationItem・showDesktopNotification)に載せ、
 * オンオフも今の通知のスイッチと同じ(新しい設定は作らない)。
 * - 新しく始まった警告の帯(CPU・メモリそれぞれ、開始の時刻で見分ける)が直近10分にあるときだけ、1回通知する
 * - 最初の取得は基準を取るだけ(起動直後に、すでに出ていた警告をまとめて通知しない)
 */

/** 通知を押したときに［負荷］を開く印(セッションの ID の代わりに渡す。exe のメインプロセスの ID の形に合わせる) */
export const PC_ALERT_TARGET = "ccd-pc-alert"
export const PC_ALERT_HREF = "/desktop-sessions/usage?tab=load"

export interface PcAlertNotifyTracker {
  update(summary: MonitorAlertSummary): NotificationItem[]
  reset(): void
}

export function createPcAlertNotifyTracker(): PcAlertNotifyTracker {
  let known: Set<string> | null = null
  return {
    reset() {
      known = null
    },
    update(summary) {
      const active = summary.items.filter((i) => i.active)
      const keys = active.map((i) => `${i.key}@${i.band.start}`)
      if (known === null) {
        known = new Set(keys)
        return []
      }
      const items: NotificationItem[] = []
      active.forEach((i, n) => {
        if (known!.has(keys[n])) return
        known!.add(keys[n])
        const over = i.band.threshold === null ? "警告" : `${i.band.threshold}% 以上`
        items.push({
          sessionId: PC_ALERT_TARGET,
          title: `PC の警告: ${ALERT_LABEL[i.key]} が ${over}`,
          body: `${bandRange(i.band)}${i.band.max === null ? "" : `（最大 ${pct(i.band.max)}）`}。リソースの［負荷］で、その時刻に動いていたものを見られます`,
        })
      })
      return items
    },
  }
}
