"use client"

import { useState } from "react"
import { Plus, FolderGit2, Pencil, Trash2, ShieldAlert } from "lucide-react"
import { useProjects } from "@/hooks/useProjects"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DirectoryPicker } from "@/components/projects/DirectoryPicker"
import { ProjectConfig } from "@/lib/types"
import { toast } from "sonner"

function suggestNameFromPath(p: string): string {
  const normalized = p.replace(/[\\/]+$/, "")
  const segments = normalized.split(/[\\/]/)
  return segments[segments.length - 1] || normalized
}

export function ProjectSwitcher() {
  const {
    projects,
    selectedProjectId,
    selectedProject,
    selectProject,
    addProject,
    updateProject,
    removeProject,
    isLoading,
  } = useProjects()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [path, setPath] = useState("")
  const [submitting, setSubmitting] = useState(false)

  function handlePickerConfirm(pickedPath: string) {
    setPath(pickedPath)
    if (!name.trim()) {
      setName(suggestNameFromPath(pickedPath))
    }
  }

  async function handleAdd() {
    if (!name.trim() || !path.trim()) {
      toast.error("プロジェクト名とパスを入力してください")
      return
    }
    setSubmitting(true)
    try {
      await addProject(name.trim(), path.trim())
      toast.success(`プロジェクト「${name}」を登録しました`)
      setName("")
      setPath("")
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "プロジェクトの追加に失敗しました")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <FolderGit2 className="size-4 text-muted-foreground shrink-0" />
      {isLoading || !selectedProjectId ? (
        <div className="h-7 w-[180px] rounded-md border border-input bg-transparent" />
      ) : (
        <Select
          value={selectedProjectId}
          onValueChange={(id) => id && selectProject(id)}
          disabled={projects.length === 0}
        >
          <SelectTrigger size="sm" className="w-[180px]">
            <SelectValue placeholder="プロジェクトを選択">
              {(value: string) => projects.find((p) => p.id === value)?.name ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {selectedProject?.isGlobalConfig && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge variant="destructive" className="gap-1">
                <ShieldAlert className="size-3" />
                グローバル設定
              </Badge>
            }
          />
          <TooltipContent>
            実際の ~/.claude を編集しています。ここでの変更はClaude Code本体の設定に直接反映されます。
          </TooltipContent>
        </Tooltip>
      )}

      {selectedProject && (
        <EditProjectDialog
          project={selectedProject}
          onSave={updateProject}
          onDelete={removeProject}
        />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button variant="outline" size="icon" aria-label="プロジェクトを追加">
              <Plus className="size-4" />
            </Button>
          }
        />
        <DialogContent className="flex max-h-[85vh] w-full max-w-xl flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>プロジェクトを追加</DialogTitle>
            <DialogDescription>
              CLAUDE.md（と任意で skills/ ・ execution_log.json）を配置している Claude Code
              プロジェクトのルートパスを登録します。下のツリーから辿るか、直接パスを入力してください。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 overflow-y-auto py-2">
            <div className="grid gap-2">
              <Label>フォルダを選択</Label>
              <DirectoryPicker onConfirm={handlePickerConfirm} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-path">プロジェクトルートパス</Label>
              <Input
                id="project-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="例: C:\\Projects\\my-app"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-name">プロジェクト名</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 営業資料自動化プロジェクト"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAdd} disabled={submitting}>
              追加する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface EditProjectDialogProps {
  project: ProjectConfig
  onSave: (id: string, updates: { name: string; path: string }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

function EditProjectDialog({ project, onSave, onDelete }: EditProjectDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(project.name)
  const [path, setPath] = useState(project.path)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function handleOpenChange(next: boolean) {
    if (next) {
      setName(project.name)
      setPath(project.path)
    }
    setOpen(next)
  }

  async function handleSave() {
    if (!name.trim() || !path.trim()) {
      toast.error("プロジェクト名とパスを入力してください")
      return
    }
    setSubmitting(true)
    try {
      await onSave(project.id, { name: name.trim(), path: path.trim() })
      toast.success(`プロジェクト「${name.trim()}」を更新しました`)
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新に失敗しました")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await onDelete(project.id)
      toast.success(`プロジェクト「${project.name}」の登録を解除しました`)
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="icon" aria-label="プロジェクトを編集">
            <Pencil className="size-4" />
          </Button>
        }
      />
      <DialogContent className="flex max-h-[85vh] w-full max-w-xl flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>プロジェクトを編集</DialogTitle>
          <DialogDescription>
            登録名やパスを変更、またはダッシュボードからの登録を解除できます（実際のフォルダやファイルは削除されません）。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 overflow-y-auto py-2">
          <div className="grid gap-2">
            <Label>フォルダを選び直す</Label>
            <DirectoryPicker onConfirm={setPath} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-project-path">プロジェクトルートパス</Label>
            <Input id="edit-project-path" value={path} onChange={(e) => setPath(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-project-name">プロジェクト名</Label>
            <Input id="edit-project-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting || submitting}
          >
            <Trash2 className="size-4" />
            登録を解除
          </Button>
          <Button onClick={handleSave} disabled={submitting || deleting}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
