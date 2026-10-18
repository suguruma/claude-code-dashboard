/**
 * モデルごとのコンテキスト使用量の上限。
 * 会話ログには使用量しか記録されず上限は無いため、ここの値はすべて「仮置き」。画面にもその旨を常時表示する。
 * モデルIDの前方一致で引く(上から順に最初に合致したもの)。`config/desktop-sessions.json` の
 * `contextLimits`(前方一致キー → 上限)で上書きできる。
 */

export const DEFAULT_CONTEXT_LIMIT = 200_000
export const EXTENDED_CONTEXT_LIMIT = 1_000_000

const DEFAULT_LIMIT_TABLE: Array<{ prefix: string; limit: number }> = [
  { prefix: "claude-haiku", limit: 200_000 },
  { prefix: "claude-opus-4-8", limit: EXTENDED_CONTEXT_LIMIT },
  { prefix: "claude-opus-5", limit: EXTENDED_CONTEXT_LIMIT },
  { prefix: "claude-sonnet-5", limit: EXTENDED_CONTEXT_LIMIT },
  { prefix: "claude-fable-5", limit: EXTENDED_CONTEXT_LIMIT },
]

export const CONTEXT_LIMIT_NOTE =
  "コンテキストの上限は記録されていないため、モデルごとの仮置き値で割っています。使用量が上限を超えた場合は上限を1Mに引き上げて表示します。"

export type ContextLimitOverrides = Record<string, number>

/**
 * モデルIDから上限を決める。`[1m]` 接尾辞があれば1M。
 * 実測の使用量が仮置きの上限を超えていたら、仮置きが小さすぎるとみなして1Mに引き上げる。
 */
export function resolveContextLimit(
  model: string | null,
  tokens: number,
  overrides: ContextLimitOverrides = {}
): number {
  const id = (model ?? "").toLowerCase()
  let limit = DEFAULT_CONTEXT_LIMIT
  if (/\[1m\]$/.test(id)) {
    limit = EXTENDED_CONTEXT_LIMIT
  } else {
    const overrideKey = Object.keys(overrides)
      .filter((k) => id.startsWith(k.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0]
    if (overrideKey && overrides[overrideKey] > 0) {
      limit = overrides[overrideKey]
    } else {
      const entry = DEFAULT_LIMIT_TABLE.find((e) => id.startsWith(e.prefix))
      if (entry) limit = entry.limit
    }
  }
  if (tokens > limit) limit = Math.max(limit, EXTENDED_CONTEXT_LIMIT)
  return limit
}
