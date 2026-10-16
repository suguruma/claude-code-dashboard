import { describe, expect, it } from "vitest"
import { computeTextSimilarity, findSimilarSkillPairs } from "./skillSimilarity"
import { SkillMeta } from "./types"

function makeSkill(overrides: Partial<SkillMeta> & Pick<SkillMeta, "dirName">): SkillMeta {
  return {
    name: overrides.dirName,
    description: "",
    body: "",
    enabled: true,
    ...overrides,
  }
}

describe("computeTextSimilarity", () => {
  it("完全一致する文字列は1を返す", () => {
    expect(computeTextSimilarity("転職の悩みを相談できます", "転職の悩みを相談できます")).toBe(1)
  })

  it("共通点が無い文字列は0を返す", () => {
    expect(computeTextSimilarity("あいうえお", "かきくけこ")).toBe(0)
  })

  it("片方が空文字なら0を返す", () => {
    expect(computeTextSimilarity("", "何か説明文")).toBe(0)
  })

  it("意味的に近い文章はある程度高いスコアになる", () => {
    const score = computeTextSimilarity(
      "キャリアの悩みをSWOT分析の観点で整理して助言します",
      "キャリアの悩みを強み・弱みの観点で整理して助言します"
    )
    expect(score).toBeGreaterThan(0.5)
  })
})

describe("findSimilarSkillPairs", () => {
  it("同カテゴリ内で類似したdescriptionの組を検出する", () => {
    const skills: SkillMeta[] = [
      makeSkill({
        dirName: "career-swot-analyzer",
        category: "career",
        description: "キャリアの選択肢をSWOT分析の観点で整理し、強み・弱み・機会・脅威を可視化します",
      }),
      makeSkill({
        dirName: "career-anchor-diagnostician",
        category: "career",
        description: "キャリアの選択肢を強み・弱み・機会・脅威の観点で整理し、可視化して助言します",
      }),
      makeSkill({
        dirName: "commit-message-writer",
        category: "dev-qa",
        description: "gitの差分からConventional Commits形式のコミットメッセージを生成します",
      }),
    ]

    const pairs = findSimilarSkillPairs(skills)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({
      category: "career",
      dirNameA: "career-swot-analyzer",
      dirNameB: "career-anchor-diagnostician",
    })
    expect(pairs[0].score).toBeGreaterThanOrEqual(0.5)
  })

  it("カテゴリが異なるスキル同士は比較しない", () => {
    const skills: SkillMeta[] = [
      makeSkill({ dirName: "a", category: "career", description: "キャリアの悩みを相談できます" }),
      makeSkill({ dirName: "b", category: "dev-qa", description: "キャリアの悩みを相談できます" }),
    ]
    expect(findSimilarSkillPairs(skills)).toEqual([])
  })

  it("descriptionが空のスキルは比較対象から除外する", () => {
    const skills: SkillMeta[] = [
      makeSkill({ dirName: "a", category: "career", description: "" }),
      makeSkill({ dirName: "b", category: "career", description: "" }),
    ]
    expect(findSimilarSkillPairs(skills)).toEqual([])
  })

  it("未分類（categoryが無い）スキル同士も同じグループとして比較する", () => {
    const skills: SkillMeta[] = [
      makeSkill({ dirName: "a", description: "キャリアの選択肢をSWOT分析の観点で整理して助言します" }),
      makeSkill({ dirName: "b", description: "キャリアの選択肢をSWOT分析の観点で整理して助言します" }),
    ]
    const pairs = findSimilarSkillPairs(skills)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].category).toBe("")
  })

  it("しきい値を上げると検出件数が減る", () => {
    const skills: SkillMeta[] = [
      makeSkill({ dirName: "a", category: "career", description: "キャリアの悩みを相談できます" }),
      makeSkill({ dirName: "b", category: "career", description: "転職に関する悩みを相談できます" }),
    ]
    const loose = findSimilarSkillPairs(skills, 0.1)
    const strict = findSimilarSkillPairs(skills, 0.99)
    expect(loose.length).toBeGreaterThanOrEqual(strict.length)
    expect(strict).toEqual([])
  })

  it("スコアの高い順にソートされる", () => {
    const skills: SkillMeta[] = [
      makeSkill({ dirName: "a", category: "career", description: "キャリアの悩みを相談できます" }),
      makeSkill({ dirName: "b", category: "career", description: "キャリアの悩みを相談できます" }),
      makeSkill({ dirName: "c", category: "career", description: "転職活動の進め方を相談できます" }),
    ]
    const pairs = findSimilarSkillPairs(skills, 0.1)
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i - 1].score).toBeGreaterThanOrEqual(pairs[i].score)
    }
  })
})
