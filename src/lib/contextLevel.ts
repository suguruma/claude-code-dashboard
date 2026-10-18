/**
 * コンテキスト使用率の段階。一覧・詳細(ContextBar)と、組織図のカードで共通に使う。DOM・fsに触れない。
 * 80%未満は通常、80%以上90%未満は黄、90%以上は赤。
 */

export const CTX_WARNING_RATIO = 0.8
export const CTX_CRITICAL_RATIO = 0.9

export type CtxLevel = "ok" | "warning" | "critical"

/** コンテキスト使用率(0〜1)の段階 */
export function ctxLevel(ratio: number): CtxLevel {
  if (ratio >= CTX_CRITICAL_RATIO) return "critical"
  if (ratio >= CTX_WARNING_RATIO) return "warning"
  return "ok"
}

/** 使用率(0〜1)。上限が不明・0のときは null */
export function ctxRatio(ctx: number | null, limit: number | null): number | null {
  if (ctx === null || limit === null || limit <= 0) return null
  return Math.min(1, ctx / limit)
}
