import { SimilarSkillPair, SkillMeta } from "./types"

/** 類似と判定するDice係数のしきい値。既定は「発火が曖昧かもしれない」を過検出しない程度に高めに設定 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.5

function toBigrams(text: string): string[] {
  const s = text.trim().toLowerCase()
  if (s.length < 2) return []
  const bigrams: string[] = []
  for (let i = 0; i < s.length - 1; i++) {
    bigrams.push(s.slice(i, i + 2))
  }
  return bigrams
}

/**
 * 文字bigramのSørensen-Dice係数による類似度（0〜1）。日本語は分かち書きが無いため、
 * 形態素解析を要さないbigram方式（Simstring等でも使われる手法）を採用する。
 */
export function computeTextSimilarity(a: string, b: string): number {
  const bigramsA = toBigrams(a)
  const bigramsB = toBigrams(b)
  if (bigramsA.length === 0 || bigramsB.length === 0) return 0

  const countsA = new Map<string, number>()
  for (const bg of bigramsA) countsA.set(bg, (countsA.get(bg) ?? 0) + 1)
  const countsB = new Map<string, number>()
  for (const bg of bigramsB) countsB.set(bg, (countsB.get(bg) ?? 0) + 1)

  let overlap = 0
  for (const [bg, countA] of countsA) {
    const countB = countsB.get(bg)
    if (countB) overlap += Math.min(countA, countB)
  }

  return (2 * overlap) / (bigramsA.length + bigramsB.length)
}

/**
 * 同カテゴリ内のスキルをdescriptionの類似度で総当たり比較し、しきい値以上の組を検出する。
 * カテゴリはダッシュボード上の表示グルーピング（frontmatterのcategory）にすぎないが、
 * 「発火が曖昧かもしれない組」の検出範囲としては元仕様どおり同カテゴリ内に限定する。
 */
export function findSimilarSkillPairs(
  skills: SkillMeta[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): SimilarSkillPair[] {
  const groups = new Map<string, SkillMeta[]>()
  for (const skill of skills) {
    const key = skill.category ?? ""
    const group = groups.get(key)
    if (group) group.push(skill)
    else groups.set(key, [skill])
  }

  const pairs: SimilarSkillPair[] = []
  for (const [category, group] of groups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        if (!a.description.trim() || !b.description.trim()) continue
        const score = computeTextSimilarity(a.description, b.description)
        if (score >= threshold) {
          pairs.push({
            category,
            dirNameA: a.dirName,
            dirNameB: b.dirName,
            labelA: a.title ?? a.name,
            labelB: b.title ?? b.name,
            score,
          })
        }
      }
    }
  }

  return pairs.sort((x, y) => y.score - x.score)
}
