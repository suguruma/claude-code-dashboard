export interface SkillCategoryMeta {
  slug: string
  emoji: string
  label: string
}

/**
 * ユーザー提供の「Claude スキル一覧」で使われている6分類をそのまま採用。
 * 実ファイルは.claude/skills/<dirName>/SKILL.mdのフラット構造のままとし、
 * このカテゴリはfrontmatterのcategoryフィールドによる表示上のグルーピングにのみ使う
 * （Claude Code本体がサブディレクトリを再帰探索しないため、実フォルダ階層化はしない）。
 */
export const SKILL_CATEGORIES: SkillCategoryMeta[] = [
  { slug: "meta-orchestration", emoji: "🤖", label: "自律制作・オーケストレーション" },
  { slug: "dev-qa", emoji: "💻", label: "開発・品質・保守" },
  { slug: "writing", emoji: "✍️", label: "ライティング・コンテンツ制作" },
  { slug: "business", emoji: "💼", label: "ビジネス・資料・議事録" },
  { slug: "design", emoji: "🎨", label: "デザイン・ビジュアル" },
  { slug: "career", emoji: "🎯", label: "キャリア・思考整理コンサル" },
]

export const UNCATEGORIZED: SkillCategoryMeta = { slug: "", emoji: "🗂️", label: "未分類" }

export function getCategoryMeta(slug: string | undefined): SkillCategoryMeta {
  return SKILL_CATEGORIES.find((c) => c.slug === slug) ?? UNCATEGORIZED
}
