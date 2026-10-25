/**
 * 要対応の種類(⑩)。Desktop が「要対応」と分類したセッションを、オーナーが何をすればよいかで分ける。
 * サーバー専用モジュールを import しない(画面の文言と並びの表を共有するため)。
 *
 * - permission: 許可待ち(ツールの実行の許可。開いて押せば進む)
 * - approval: 承認待ち(コミット・push・マージ・PR・プラン・外部への操作。開いて押せば進む)
 * - decision: 判断待ち(選ぶ・答える・決める)
 * - unknown: 要対応(種類不明)。見落とさないよう、判断待ちと同じ扱いで数に入れる
 * 待機(次の連絡や条件を待っているだけ)は要対応ではないので、ここには入れず、状態 standby にする。
 */
export type NeedsActionKind = "permission" | "approval" | "decision" | "unknown"

/** 種類を決めた手がかり。言葉からの推定(summary-words)だけが「推定」 */
export type NeedsActionSource =
  | "plan-tool" // 会話ログの最後が ExitPlanMode の呼び出し
  | "ask-tool" // 会話ログの最後が AskUserQuestion の呼び出し
  | "wrap-up-action" // 最後のターンの wrap_up の質問と、承認のボタン(commit・create_pr・merge)
  | "wrap-up-ask" // 最後のターンの wrap_up の質問
  | "wrap-up-no-ask" // 最後のターンの wrap_up に質問が無い(待機)
  | "summary-words" // Desktop の要約の言葉からの推定
  | "none" // 手がかりが無い

/** 言葉の推定で決まる種類。待機(standby)も含む */
export type WordKind = NeedsActionKind | "standby"

/**
 * 最後のターンの wrap_up の呼び出しの入力から、分類と「次にやる判断」(⑬)に使う値だけを取り出したもの。
 * 文は ask(全文。上限あり)とボタンの名前(label)だけ。recap・ボタンの message は取り込まない
 */
export interface WrapUpDigest {
  /** ask の先頭60文字。ask が無ければ null */
  askExcerpt: string | null
  /** ask の全文(空白をつめ、上限で切る)。次にやる判断の問いに使う。ask が無ければ null */
  ask: string | null
  /** 承認の判断に使うため、ask の全文から言葉で推定した種類 */
  askWordKind: WordKind | null
  /** ボタンの操作の名前。ボタンの名前(label)の文から決めたもの(⑬ D6)と、古い形の action のキーのうち決まった名前のもの */
  actions: string[]
  /** ボタンの名前(label)。答えの候補に使う */
  labels: string[]
  blocked: boolean | null
}

/** wrap_up のボタンの操作として取り込む名前(これ以外の値は捨てる) */
export const WRAP_UP_ACTIONS = [
  "commit",
  "create_pr",
  "merge",
  "fix_ci",
  "address_comments",
  "resolve_conflicts",
  "verify",
  "archive",
  "new_session",
] as const

/** 承認待ちにするボタンの操作 */
const APPROVAL_ACTIONS = new Set(["commit", "create_pr", "merge"])

/**
 * ボタンの名前(label)の文から決める承認の操作(⑬ D6・A8)。実際の wrap_up のボタンは `label` と `message` だけで、
 * `action` のキーは使われていない(2026-10-24 に直近の会話ログ60本のボタン 419個を数えて 0個)ため、文から決める
 */
const APPROVAL_LABEL_TABLE: Array<{ action: string; pattern: RegExp }> = [
  { action: "commit", pattern: /コミット|commit/i },
  { action: "create_pr", pattern: /プルリク|\bPR\b|pull request/i },
  { action: "merge", pattern: /マージ|merge/i },
]

/** ボタンの名前から、承認の操作の名前を返す(当たらなければ空) */
export function approvalActionsOfLabel(label: string): string[] {
  return APPROVAL_LABEL_TABLE.filter(({ pattern }) => pattern.test(label)).map(({ action }) => action)
}

/**
 * 言葉の表。上から順に調べ、最初に当たった種類にする。
 * 「選ぶ・決める」の語を承認の語より先に見る(「4つを決めて。決まったら commit します」は判断待ち)。
 * 疑問符は、承認の語の後ろ・待機の語の前に見る。「コミットしてよいですか？」は承認待ちのまま、
 * 「届いたら続けますが、それでよいですか？」は判断待ち(質問が待機に落ちて、要対応から消えないようにする。⑩ ゲート2)。
 */
const WORD_TABLE: Array<{ kind: WordKind; pattern: RegExp }> = [
  { kind: "decision", pattern: /決めて|選んで|選択して|どれ|どちら|どの案|答えて|回答|教えて|方針/ },
  { kind: "permission", pattern: /許可|権限|permission|allow/i },
  { kind: "approval", pattern: /承認|コミット|commit|push|プッシュ|マージ|merge|プルリク|\bPR\b|反映|デプロイ|deploy|公開して|送信して/i },
  { kind: "decision", pattern: /[?？]/ },
  // 「ご確認をお待ちしています」のように、オーナーの操作を待つ言い方は待機にしない(「待ち」だけでは当てない)。
  // 「来たら」は「出来たら」(できたら)に当てない
  { kind: "standby", pattern: /待機|待っています|待ちます|次の連絡|届いたら|(?<!出)来たら|終わったら|見張/ },
]

/** 言葉から種類を推定する。どれにも当たらなければ null */
export function kindFromWords(text: string | null | undefined): WordKind | null {
  if (!text) return null
  for (const { kind, pattern } of WORD_TABLE) {
    if (pattern.test(text)) return kind
  }
  return null
}

export interface ClassifyInput {
  /** 会話ログの最後で止まっている、回答を待つツールの名前(ExitPlanMode・AskUserQuestion)。無ければ null */
  awaitingTool: string | null
  /** 最後のターンの wrap_up。無ければ null */
  wrapUp: WrapUpDigest | null
  /** Desktop の要約の言葉(needs_action・status_detail)から推定した種類。文は受け取らない */
  summaryWordKind: WordKind | null
}

export interface ClassifyResult {
  /** standby は待機(要対応ではない) */
  kind: NeedsActionKind | "standby"
  source: NeedsActionSource
  /** 言葉からの推定なら true(画面に「推定」と出す) */
  estimated: boolean
}

/**
 * 要対応の種類を決める(ゲート1の条件1・2)。上から順に、当てはまった最初の手がかりで決める。
 * 1. ExitPlanMode で止まっている → 承認待ち
 * 2. AskUserQuestion で止まっている → 判断待ち
 * 3. 最後のターンの wrap_up：ask があり、承認のボタン(commit・create_pr・merge)があるか ask の言葉が承認 → 承認待ち、
 *    それ以外の ask → 判断待ち。ask が無い → 待機(セッションが自分で「待つだけ」と言っている)
 * 4. Desktop の要約の言葉から推定(推定)。許可待ちは、確かな手がかりが無いので、ここでだけ付く
 * 5. どれにも当たらない → 種類不明(判断待ちと同じく数に入れる)
 */
export function classifyNeedsAction(input: ClassifyInput): ClassifyResult {
  if (input.awaitingTool === "ExitPlanMode") return { kind: "approval", source: "plan-tool", estimated: false }
  if (input.awaitingTool === "AskUserQuestion") return { kind: "decision", source: "ask-tool", estimated: false }
  const w = input.wrapUp
  if (w) {
    if (w.askExcerpt === null) return { kind: "standby", source: "wrap-up-no-ask", estimated: false }
    if (w.actions.some((a) => APPROVAL_ACTIONS.has(a))) return { kind: "approval", source: "wrap-up-action", estimated: false }
    return { kind: w.askWordKind === "approval" ? "approval" : "decision", source: "wrap-up-ask", estimated: false }
  }
  if (input.summaryWordKind) return { kind: input.summaryWordKind, source: "summary-words", estimated: true }
  return { kind: "unknown", source: "none", estimated: false }
}

/** 種類の名前(画面の文言) */
export const NEEDS_ACTION_KIND_LABEL: Record<NeedsActionKind, string> = {
  permission: "許可待ち",
  approval: "承認待ち",
  decision: "判断待ち",
  unknown: "要対応（種類不明）",
}

/** 手がかりの名前(画面の文言) */
export function needsActionSourceLabel(source: NeedsActionSource, actions: string[] = []): string {
  switch (source) {
    case "plan-tool":
      return "プランの承認（ExitPlanMode）"
    case "ask-tool":
      return "質問（AskUserQuestion）"
    case "wrap-up-action": {
      const names = actions.filter((a) => APPROVAL_ACTIONS.has(a))
      return `wrap_up のボタン（${names.join("・") || "承認"}）`
    }
    case "wrap-up-ask":
      return "wrap_up の質問"
    case "wrap-up-no-ask":
      return "wrap_up に質問が無い（待つだけ）"
    case "summary-words":
      return "要約の言葉から推定"
    case "none":
      return "手がかりなし"
  }
}

/**
 * 一覧とホームの行に出す「分けた手がかり」。要対応(種類つき)と待機のときだけ返し、ほかの状態は null。
 * 状態と食い違う情報(要対応でないのに残った needsActionInfo など)は出さない
 */
export function sessionClueLabel(s: {
  status: string
  needsActionInfo: { source: NeedsActionSource; buttons: string[] } | null
  standbyInfo: { source: NeedsActionSource } | null
}): string | null {
  if (s.status === "blocked" && s.needsActionInfo) return needsActionSourceLabel(s.needsActionInfo.source, s.needsActionInfo.buttons)
  if (s.status === "standby" && s.standbyInfo) return needsActionSourceLabel(s.standbyInfo.source)
  return null
}

/** 並びの順(すぐ押せるものを上に)。小さいほど上 */
export const NEEDS_ACTION_KIND_RANK: Record<NeedsActionKind, number> = {
  permission: 0,
  approval: 1,
  decision: 2,
  unknown: 2,
}
