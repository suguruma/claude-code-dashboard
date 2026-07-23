"use client"

import { useState } from "react"
import { Plus, FolderGit2 } from "lucide-react"
import { useProjects } from "@/hooks/useProjects"
import { Button } from "@/components/ui/button"
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
import { toast } from "sonner"

export function ProjectSwitcher() {
  const { projects, selectedProjectId, selectProject, addProject, isLoading } = useProjects()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [path, setPath] = useState("")
  const [submitting, setSubmitting] = useState(false)

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
            <SelectValue placeholder="プロジェクトを選択" />
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button variant="outline" size="icon" aria-label="プロジェクトを追加">
              <Plus className="size-4" />
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>プロジェクトを追加</DialogTitle>
            <DialogDescription>
              rules.json / execution_log.json / CLAUDE.md を配置している Claude Code
              プロジェクトのルートパスを登録します。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="project-name">プロジェクト名</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 営業資料自動化プロジェクト"
              />
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
