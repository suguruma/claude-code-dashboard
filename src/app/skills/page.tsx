"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { useProjects } from "@/hooks/useProjects"
import { useSkills } from "@/hooks/useSkills"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { CategorySection } from "@/components/skills/CategorySection"
import { SkillListCard } from "@/components/skills/SkillListCard"
import { SkillFormDialog } from "@/components/skills/SkillFormDialog"
import { SkillMeta } from "@/lib/types"
import { SKILL_CATEGORIES, UNCATEGORIZED } from "@/lib/skillCategories"

export default function SkillsPage() {
  const { selectedProjectId, selectedProject, isLoading: projectsLoading } = useProjects()
  const { skills, isLoading, error, createSkill, updateSkill, deleteSkill, renameSkill } =
    useSkills(selectedProjectId)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<SkillMeta | null>(null)
  const [formKey, setFormKey] = useState(0)
  // カテゴリはデフォルトで折りたたみ、クリックした分だけ展開してスクロール量を減らす
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  function toggleCategory(slug: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  function openCreateDialog() {
    setEditingSkill(null)
    setFormKey((k) => k + 1)
    setDialogOpen(true)
  }

  function openEditDialog(skill: SkillMeta) {
    setEditingSkill(skill)
    setFormKey((k) => k + 1)
    setDialogOpen(true)
  }

  async function handleSubmit(input: {
    dirName: string
    description: string
    body: string
    category?: string
    title?: string
    targetModel?: string
  }) {
    try {
      if (editingSkill) {
        let dirName = editingSkill.dirName
        if (input.dirName !== editingSkill.dirName) {
          await renameSkill(editingSkill.dirName, input.dirName)
          dirName = input.dirName
        }
        await updateSkill(dirName, {
          description: input.description,
          body: input.body,
          category: input.category,
          title: input.title,
          targetModel: input.targetModel,
        })
        toast.success("スキルを更新しました")
      } else {
        await createSkill(input)
        toast.success("スキルを追加しました")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存に失敗しました")
      throw err
    }
  }

  const groupedSkills = [...SKILL_CATEGORIES, UNCATEGORIZED].map((category) => ({
    category,
    skills: skills.filter((s) => (s.category ?? "") === category.slug),
  })).filter((group) => group.skills.length > 0)

  if (projectsLoading) {
    return <p className="text-sm text-muted-foreground">読み込み中...</p>
  }

  if (!selectedProject) {
    return (
      <Alert>
        <AlertTitle>プロジェクトが未登録です</AlertTitle>
        <AlertDescription>
          画面右上の「+」からプロジェクトを登録してください。
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">スキル管理</h1>
          <p className="text-sm text-muted-foreground">
            {selectedProject.name} の .claude/skills/*/SKILL.md を管理します
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="size-4" />
          スキルを追加
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>読み込みエラー</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {!isLoading && skills.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          skills ディレクトリが無いか、まだスキルが登録されていません。
        </p>
      )}

      <div className="space-y-4">
        {groupedSkills.map(({ category, skills: groupSkills }) => (
          <CategorySection
            key={category.slug}
            emoji={category.emoji}
            label={category.label}
            count={groupSkills.length}
            expanded={expandedCategories.has(category.slug)}
            onToggle={() => toggleCategory(category.slug)}
          >
            <div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-3">
              {groupSkills.map((skill) => (
                <SkillListCard
                  key={skill.dirName}
                  skill={skill}
                  onEdit={openEditDialog}
                  onDelete={deleteSkill}
                />
              ))}
            </div>
          </CategorySection>
        ))}
      </div>

      <SkillFormDialog
        key={formKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialSkill={editingSkill}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
