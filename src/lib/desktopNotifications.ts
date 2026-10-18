import type { DesktopSessionSummary } from "./desktopSessionTypes"

/**
 * 要対応のデスクトップ通知(段階2)の「いつ・何を通知するか」を決める純粋なロジック。
 * 通知の表示そのもの(ブラウザのNotification API / ElectronのNotification)は含まない。
 */

export interface NotificationItem {
  /** 通知をクリックしたときに詳細を開くセッション。まとめの通知は null(一覧を開く) */
  sessionId: string | null
  title: string
  body: string
}

/** 通知の本文は、セッション名と要対応の内容の抜粋だけにする(会話の本文は含めない) */
export function buildNotification(session: DesktopSessionSummary): NotificationItem {
  return {
    sessionId: session.id,
    title: `要対応: ${session.title}`,
    // 要約文が無い要対応(質問の回答待ちなど)は、状態の根拠を使う。これは固定の文言で、会話の本文を含まない
    body: session.needsActionExcerpt ?? session.statusReason,
  }
}

/** 一度に通知する最大件数。超えた分は1件のまとめにして、通知の洪水を避ける */
export const MAX_INDIVIDUAL_NOTIFICATIONS = 4

/** 同時に要対応になった件数が多いときは、先頭の数件を個別に通知し、残りを1件にまとめる */
export function planNotifications(items: NotificationItem[]): NotificationItem[] {
  if (items.length <= MAX_INDIVIDUAL_NOTIFICATIONS + 1) return items
  const rest = items.length - MAX_INDIVIDUAL_NOTIFICATIONS
  return [
    ...items.slice(0, MAX_INDIVIDUAL_NOTIFICATIONS),
    { sessionId: null, title: `ほかに${rest}件が要対応になりました`, body: "Desktopセッションの一覧で確認できます" },
  ]
}

export interface NotifyTracker {
  /** 取得した一覧を渡し、新しく要対応になったセッションの通知を返す */
  update(sessions: DesktopSessionSummary[]): NotificationItem[]
  /** 通知をオフにしたとき等に、基準(起動時の状態)を捨てる。次の update は基準の取り直しになる */
  reset(): void
}

/**
 * 「新しく要対応になった」ことを検出する。
 * - 最初の update は基準を取るだけで、通知しない(起動直後に、すでに要対応だったものをまとめて通知しない)。
 * - 前回までに要対応だったセッションは、要対応のあいだは何度取得しても通知しない(同じ状態では1回)。
 *   要対応でなくなってから、また要対応になれば、新たに通知する。
 * - アーカイブ済みは通知しない。一覧から一時的に消えたセッションが戻っても、再通知しないよう前回の状態を保つ。
 */
export function createNotifyTracker(): NotifyTracker {
  let known: Map<string, DesktopSessionSummary["status"]> | null = null

  return {
    reset() {
      known = null
    },
    update(sessions) {
      const active = sessions.filter((s) => !s.isArchived)
      if (known === null) {
        known = new Map(active.map((s) => [s.id, s.status]))
        return []
      }
      const items: NotificationItem[] = []
      for (const s of active) {
        if (s.status === "blocked" && known.get(s.id) !== "blocked") items.push(buildNotification(s))
        known.set(s.id, s.status)
      }
      return items
    },
  }
}
