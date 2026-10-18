import type { UsagePrice } from "./usageTypes"

/**
 * モデルごとの単価(100万トークンあたりのドル)と、使用量の金額換算。
 * 金額は「上限をどれだけ使ったか」の相対的な大きさを測る物差しで、請求額ではない。
 * 較正の係数が全体の大きさを吸収するので、効くのはモデル間の比だけ。価格表は設定ファイルで直せる。
 *
 * 価格表の引き方: 実際のモデルID → 系統(opus・sonnet・haiku・fable)で表にある最新 → 無ければopusの価格(登録なしとして知らせる)。
 */

export type ModelFamily = "opus" | "sonnet" | "haiku" | "fable"

const FAMILIES: ModelFamily[] = ["opus", "sonnet", "haiku", "fable"]

export interface PriceEntry {
  id: string
  family: ModelFamily
  /** IDの数字部分(claude-opus-5-5 → [5,5])。系統の最新を選ぶために使う */
  version: number[]
  price: UsagePrice
}

/** 既定の価格表(検証で使われた値。公式の価格表では確認していないため、設定ファイルで直せる) */
export const DEFAULT_PRICES: Record<string, UsagePrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  // 検証の表にはキャッシュ読み取りの単価が無い。入力の1/10で仮置きする
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
}

/** キャッシュ作成の単価は入力単価の倍率: 5分は1.25倍、1時間は2倍 */
export const CACHE_WRITE_5M_RATIO = 1.25
export const CACHE_WRITE_1H_RATIO = 2

export function familyOf(model: string): ModelFamily | null {
  const lower = model.toLowerCase()
  return FAMILIES.find((f) => lower.includes(f)) ?? null
}

function versionOf(id: string): number[] {
  return (id.match(/\d+/g) ?? []).map(Number)
}

function compareVersion(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function validPrice(value: unknown): UsagePrice | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const nums = [v.input, v.output, v.cacheRead]
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) return null
  return { input: v.input as number, output: v.output as number, cacheRead: v.cacheRead as number }
}

/** 設定ファイルの `prices`(モデルIDまたは系統名 → 単価)を読む。形式が不正な項目は無視する */
export function parsePriceOverrides(raw: unknown): Record<string, UsagePrice> {
  const result: Record<string, UsagePrice> = {}
  if (!raw || typeof raw !== "object") return result
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const price = validPrice(value)
    if (price && key.trim()) result[key.trim().toLowerCase()] = price
  }
  return result
}

export interface PriceResolution {
  price: UsagePrice
  /** 価格表のどの項目で引いたか。none はopusの仮価格 */
  via: "exact" | "family" | "none"
}

export class PriceBook {
  private readonly overrides: Record<string, UsagePrice>
  private readonly entries: PriceEntry[]

  constructor(overrides: Record<string, UsagePrice> = {}) {
    this.overrides = overrides
    const merged: Record<string, UsagePrice> = { ...DEFAULT_PRICES }
    for (const [id, price] of Object.entries(overrides)) {
      if (!FAMILIES.includes(id as ModelFamily)) merged[id] = price
    }
    this.entries = []
    for (const [id, price] of Object.entries(merged)) {
      const family = familyOf(id)
      if (family) this.entries.push({ id: id.toLowerCase(), family, version: versionOf(id), price })
    }
  }

  resolve(model: string): PriceResolution {
    const id = model.toLowerCase()
    const direct = this.overrides[id] ?? this.entries.find((e) => e.id === id)?.price
    if (direct) return { price: direct, via: "exact" }

    const family = familyOf(id)
    if (family) {
      // 設定ファイルで系統名そのもの(opus 等)に付けた単価を最優先し、無ければ表にある系統の最新を使う
      const familyOverride = this.overrides[family]
      if (familyOverride) return { price: familyOverride, via: "family" }
      const latest = this.entries
        .filter((e) => e.family === family)
        .sort((a, b) => compareVersion(b.version, a.version))[0]
      if (latest) return { price: latest.price, via: "family" }
    }
    const fallback = this.overrides.opus ?? this.entries.filter((e) => e.family === "opus").sort((a, b) => compareVersion(b.version, a.version))[0]?.price
    return { price: fallback ?? DEFAULT_PRICES["claude-opus-5-5"], via: "none" }
  }
}

export interface RowTokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

/** 1回の応答の使用量をドルに換算する */
export function costOf(tokens: RowTokens, price: UsagePrice): number {
  return (
    (tokens.input * price.input +
      tokens.output * price.output +
      tokens.cacheRead * price.cacheRead +
      tokens.cacheWrite5m * price.input * CACHE_WRITE_5M_RATIO +
      tokens.cacheWrite1h * price.input * CACHE_WRITE_1H_RATIO) /
    1_000_000
  )
}
