import type { DesktopSessionSummary } from "./desktopSessionTypes"
import { NEEDS_ACTION_KIND_LABEL } from "./needsActionKind"

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
    // 要対応の種類が分かっていれば、種類の名前にする(⑩)
    title: `${session.needsActionInfo ? NEEDS_ACTION_KIND_LABEL[session.needsActionInfo.kind] : "要対応"}: ${session.title}`,
    // 要約文が無い要対応(質問の回答待ちなど)は、状態の根拠を使う。これは固定の文言で、会話の本文を含まない
    body: session.needsActionExcerpt ?? session.statusReason,
  }
}

/**
 * 送信上限で止まったセッションの通知。本文は固定の文言で、会話の本文は含めない。
 * 止まったままでは他のセッションへ何も送れず、運用が止まるため、要対応と同じ通知のスイッチに従って知らせる。
 */
export function buildSendLimitNotification(session: DesktopSessionSummary): NotificationItem {
  return {
    sessionId: session.id,
    title: `送信上限で停止: ${session.title}`,
    body: "他のセッションへ送れる回数に達しました。このセッションで一言入力すると解除されます",
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
    { sessionId: null, title: `ほかに${rest}件の通知があります`, body: "Desktopセッションの一覧で確認できます" },
  ]
}

export interface NotifyTracker {
  /** 取得した一覧を渡し、新しく要対応になったセッションの通知を返す */
  update(sessions: DesktopSessionSummary[]): NotificationItem[]
  /** 通知をオフにしたとき等に、基準(起動時の状態)を捨てる。次の update は基準の取り直しになる */
  reset(): void
}

/**
 * 「新しく要対応になった」「新しく送信上限で止まった」ことを検出する。
 * - 最初の update は基準を取るだけで、通知しない(起動直後に、すでに要対応・停止中だったものをまとめて通知しない)。
 * - 前回までに要対応(停止中)だったセッションは、そのあいだは何度取得しても通知しない(同じ状態では1回)。
 *   そうでなくなってから、また当てはまれば、新たに通知する。
 * - 送信上限での停止は、会話ログの末尾だけを読んだ暫定の要約では判断できないことがある(止まったのが末尾より前のとき)。
 *   判断できない間は何も記録せず、あとで判断できるようになった時点では通知しない(古い停止を、新しい停止と取り違えない)。
 * - アーカイブ済みは通知しない。一覧から一時的に消えたセッションが戻っても、再通知しないよう前回の状態を保つ。
 */
export function createNotifyTracker(): NotifyTracker {
  let known: Map<string, DesktopSessionSummary["status"]> | null = null
  /** 送信上限で停止中かの、前回までの判断 */
  let stopped = new Map<string, boolean>()
  /** 停止中かを判断できないまま見ていたセッション */
  let undecided = new Set<string>()

  return {
    reset() {
      known = null
      stopped = new Map()
      undecided = new Set()
    },
    update(sessions) {
      const active = sessions.filter((s) => !s.isArchived)
      const baseline = known === null
      const items: NotificationItem[] = []
      const nextKnown = known ?? new Map<string, DesktopSessionSummary["status"]>()
      known = nextKnown
      for (const s of active) {
        if (!baseline && s.status === "blocked" && nextKnown.get(s.id) !== "blocked") items.push(buildNotification(s))
        nextKnown.set(s.id, s.status)

        const m = s.messaging
        if (!m) continue
        if (!m.exact && !m.stopped) {
          if (!stopped.has(s.id)) undecided.add(s.id)
          continue
        }
        const previous = stopped.get(s.id)
        // 前回は停止中でなかった、または初めて見たセッション(判断できないまま見ていたものを除く)が、いま停止中
        const newlyStopped = m.stopped && (previous === false || (previous === undefined && !undecided.has(s.id)))
        if (newlyStopped && !baseline) items.push(buildSendLimitNotification(s))
        stopped.set(s.id, m.stopped)
        undecided.delete(s.id)
      }
      return items
    },
  }
}
