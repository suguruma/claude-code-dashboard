import type { NotificationItem } from "./desktopNotifications"
import { formatPercent, formatRemaining } from "./usageFormat"
import type { UsageResponse, UsageWindowView } from "./usageTypes"

/**
 * 利用上限のデスクトップ通知(⑥)の「いつ・何を通知するか」を決める純粋なロジック。段階2の通知の仕組み
 * (desktopNotifications.ts の NotificationItem・showDesktopNotification)に載せる。
 *
 * 80%と95%を超えたとき、窓の枠ごとに、しきい値ごとに1回だけ通知する。
 * - 判定する%は、画面のゲージと同じ(推定があれば推定、無ければ公式値)
 * - 最初の取得は基準を取るだけで通知しない(起動直後に、すでに超えていたものをまとめて通知しない)
 * - 枠が切り替わったら(resetsAtが変わったら)、新しい枠として数え直す
 * - 一度通知したしきい値は、推定が下がっても再通知しない。上のしきい値を超えたときだけ通知する
 */
export const USAGE_NOTIFY_THRESHOLDS = [80, 95] as const

export interface UsageNotifyTracker {
  update(response: Pick<UsageResponse, "windows" | "extraUsage" | "generatedAt">): NotificationItem[]
  reset(): void
}

/** resetsAtは記録によって秒の端数がずれるので、分に丸めて同じ枠かを見る */
function instanceKey(w: UsageWindowView): string | null {
  return w.resetsAt === null ? null : `${w.id}@${Math.round(w.resetsAt / 60_000)}`
}

function highestCrossed(percent: number): number {
  return USAGE_NOTIFY_THRESHOLDS.filter((t) => percent >= t).reduce((max, t) => Math.max(max, t), 0)
}

export function buildUsageNotification(
  w: UsageWindowView,
  threshold: number,
  now: number,
  extraUsageEnabled: boolean
): NotificationItem {
  const percent = w.displayPercent ?? threshold
  const source = w.estimate.kind === "estimate" ? "推定" : "公式値"
  const remaining = w.resetsAt !== null ? `、リセットまで${formatRemaining(w.resetsAt - now).replace(/^あと/, "")}` : ""
  const extra = threshold >= 95 && extraUsageEnabled ? "。追加利用がオンのため、100%に達すると課金が始まります" : ""
  return {
    // 特定のセッションの通知ではないため、クリックしたらDesktopセッションの一覧(上部に利用上限)を開く
    sessionId: null,
    title: `利用上限: ${w.label}が${threshold}%を超えました`,
    body: `${source} ${formatPercent(percent)}%${remaining}${extra}`,
  }
}

export function createUsageNotifyTracker(): UsageNotifyTracker {
  let known: Map<string, number> | null = null

  return {
    reset() {
      known = null
    },
    update(response) {
      const items: NotificationItem[] = []
      const current = new Map<string, { w: UsageWindowView; crossed: number }>()
      for (const w of response.windows) {
        const key = instanceKey(w)
        if (key === null || w.displayPercent === null) continue
        current.set(key, { w, crossed: highestCrossed(w.displayPercent) })
      }
      if (known === null) {
        known = new Map([...current].map(([key, v]) => [key, v.crossed]))
        return []
      }
      for (const [key, { w, crossed }] of current) {
        const notified = known.get(key) ?? 0
        if (crossed > notified) {
          items.push(buildUsageNotification(w, crossed, response.generatedAt, response.extraUsage?.enabled === true))
          known.set(key, crossed)
        } else if (!known.has(key)) {
          known.set(key, crossed)
        }
      }
      return items
    },
  }
}
