/**
 * ⑲ 全体マップで、どのセッションのルートを出すかを決める(DOM に触れない純粋な関数)。
 * - URL のセッション(セッションの詳細の［地図で見る］)が一覧にあれば、それ
 * - 一覧に無いときは、すぐに「出せません」と言わない。覚えた一覧が古いだけのことがある(窓を開いたまま後から始まったセッション。
 *   ゲート2 の中7)ので、一覧を一度取り直してから決める。取り直しの間は checking
 * - URL のセッションが無ければ、既定(直近のセッション。指示が無かったセッションは飛ばす。低12・低13)
 * - 一度取り直し終えた id は、その後の取り直し(再接続など)の間も missing のまま(地図の部品を外さない)
 */

export type SessionDecision =
  | { kind: "chosen"; id: string | null; auto: boolean }
  | { kind: "checking" }
  | { kind: "missing" }

export interface SessionDecisionInput {
  /** URL などで頼まれたセッション(無ければ null) */
  requested: string | null
  sessions: readonly { id: string }[]
  defaultSession: string | null
  /** 既定で選んで指示が無かったセッション */
  skipped: readonly string[]
  /** 一覧を取りに行っている途中か */
  validating: boolean
  /** 一覧を取り直し終えた、頼まれたセッションの id(まだなら null) */
  refreshedFor: string | null
}

export function decideSession(o: SessionDecisionInput): SessionDecision {
  if (o.requested !== null) {
    if (o.sessions.some((s) => s.id === o.requested)) return { kind: "chosen", id: o.requested, auto: false }
    if (o.refreshedFor !== o.requested) return { kind: "checking" }
    return { kind: "missing" }
  }
  const id = o.sessions.find((s) => !o.skipped.includes(s.id))?.id ?? o.defaultSession
  return { kind: "chosen", id, auto: true }
}

/** 飛ばしたセッションと、飛ばした時の「最後に動いた時刻」 */
export interface SkippedSession {
  id: string
  at: number | null
}

/**
 * 今も飛ばすセッションの id。飛ばした後に動いた(時刻が変わった)セッションは、指示が入ったかもしれないので飛ばすのをやめる。
 * 一覧から消えたセッションも外す(上限の数に数えない)
 */
export function liveSkipped(skipped: readonly SkippedSession[], sessions: readonly { id: string; lastActivityAt: number | null }[]): string[] {
  return skipped.filter((k) => sessions.some((s) => s.id === k.id && s.lastActivityAt === k.at)).map((k) => k.id)
}
