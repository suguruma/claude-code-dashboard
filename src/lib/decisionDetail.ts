import { redactPathsInText } from "./lanAccess/redact"
import type { DesktopNeedsActionInfo, DesktopSessionStatus } from "./desktopSessionTypes"
import type { PendingAsk, PendingTool } from "./transcriptDigest"
import type { WrapUpDigest } from "./needsActionKind"

/**
 * 次にやる判断(⑬ ND-2・ND-4・ND-5・ND-9)の1行に出す、問いの文と答えの候補。
 * 判断を待つセッション(要対応・送信上限・エラー・届かない送信)だけに付け、ほかのセッションの会話の本文は返さない。
 * 文の中の作業フォルダのパスは、サーバーで隠す(スマホと同じ隠し方)。
 */
export interface DecisionDetail {
  /** 問いの文(全文)。取れなければ null(画面は「問いは取れません（開いて読む）」) */
  question: string | null
  /**
   * 問いの出どころ。wrap-up: wrap_up の ask / ask-tool: AskUserQuestion の先頭の問い / plan: ExitPlanMode のプランの1行目 /
   * tool: 結果を待っているツールの呼び出し(許可待ちの推定) / summary: Desktop の要約の needs_action(画面は「要約：」と薄い字)
   */
  questionSource: "wrap-up" | "ask-tool" | "plan" | "tool" | "summary" | null
  /** AskUserQuestion の残りの問いの数(「ほか n問」) */
  moreQuestions: number
  /** 答えの候補(最大5) */
  options: string[]
  /** 出していない候補の数(「ほか n」) */
  moreOptions: number
  /** 推しの候補の位置(options の添字)。無ければ null */
  recommended: number | null
  /** エラーの文の先頭(エラーのときだけ) */
  errorText: string | null
}

export const MAX_SHOWN_OPTIONS = 5

/** 選択肢の名前の末尾の推しの印(⑬ A4 の (1))。印は外して返す */
const RECOMMENDED_MARK = /\s*[（(]\s*(?:recommended|推奨|おすすめ)\s*[)）]\s*$/i

export interface DecisionDetailInput {
  status: DesktopSessionStatus
  needsActionInfo: DesktopNeedsActionInfo | null
  wrapUp: WrapUpDigest | null
  pendingAsk: PendingAsk | null
  pendingPlanLine: string | null
  pendingTool: PendingTool | null
  /** Desktop の要約の needs_action の全文 */
  summaryText: string | null
  errorText: string | null
}

/**
 * 問いの文と答えの候補を決める(⑬ A2・A4)。
 * - 問いの出どころの順：wrap_up の ask → AskUserQuestion の問い → ExitPlanMode の1行目 → 要約の needs_action。
 *   許可待ち(推定)だけは、要約より先に、結果を待っているツールの呼び出し(ツール名と先頭40字)を出す
 * - 答えの候補は、AskUserQuestion の選択肢と wrap_up のボタンの名前だけから作る。プランの承認・許可の決まった2択と、
 *   要約の言葉だけのものには、候補と推しを出さない
 * - 推しは、選択肢の名前の末尾の「(Recommended)」「（推奨）」の印。印が無く、問いが wrap_up の ask のときは、
 *   先頭のボタン(actions[0])を推しにする。wrap_up の道具の説明に「recommendation first」「actions[0] is drawn as the
 *   primary button」とあるため(ボタンが1つなら、それが推し。label に印は付かない。要件メモ 3-2)
 */
export function buildDecisionDetail(input: DecisionDetailInput): DecisionDetail {
  const info = input.status === "blocked" ? input.needsActionInfo : null
  let question: string | null = null
  let questionSource: DecisionDetail["questionSource"] = null
  let moreQuestions = 0
  let rawOptions: string[] = []
  let fromWrapUp = false

  if (info) {
    const ask = input.wrapUp?.ask ?? null
    if (info.source.startsWith("wrap-up") && ask) {
      question = ask
      questionSource = "wrap-up"
      rawOptions = input.wrapUp?.labels ?? []
      fromWrapUp = true
    } else if (input.pendingAsk) {
      question = input.pendingAsk.question
      questionSource = "ask-tool"
      moreQuestions = Math.max(0, input.pendingAsk.count - 1)
      rawOptions = input.pendingAsk.options
    } else if (input.pendingPlanLine) {
      question = `プランの承認：${input.pendingPlanLine}`
      questionSource = "plan"
    } else if (info.kind === "permission" && input.pendingTool && input.pendingTool.preview) {
      question = `${input.pendingTool.name}：${input.pendingTool.preview}`
      questionSource = "tool"
    } else if (input.summaryText) {
      question = input.summaryText
      questionSource = "summary"
    }
  }

  let recommended: number | null = null
  const cleaned = rawOptions.map((label, i) => {
    if (!RECOMMENDED_MARK.test(label)) return label
    if (recommended === null) recommended = i
    return label.replace(RECOMMENDED_MARK, "")
  })
  if (recommended === null && fromWrapUp && cleaned.length > 0) recommended = 0
  const options = cleaned.slice(0, MAX_SHOWN_OPTIONS).map(redactPathsInText)
  if (recommended !== null && recommended >= MAX_SHOWN_OPTIONS) recommended = null

  return {
    question: question === null ? null : redactPathsInText(question),
    questionSource,
    moreQuestions,
    options,
    moreOptions: Math.max(0, cleaned.length - options.length),
    recommended,
    errorText: input.status === "error" && input.errorText ? redactPathsInText(input.errorText) : null,
  }
}
