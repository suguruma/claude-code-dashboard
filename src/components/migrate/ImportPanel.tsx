"use client"

import { useRef, useState, type ChangeEvent, type DragEvent } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useExportImport } from "@/hooks/useExportImport"
import { ExportBundle, ImportDiffItem, ImportDiffResult } from "@/lib/types"
import { ImportDiffList, itemKey } from "./ImportDiffList"

interface ImportPanelProps {
  projectId: string
  isGlobalConfig?: boolean
}

export function ImportPanel({ projectId, isGlobalConfig }: ImportPanelProps) {
  const { diffImport, applyImport } = useExportImport(projectId)
  const [fileName, setFileName] = useState<string | null>(null)
  const [bundle, setBundle] = useState<ExportBundle | null>(null)
  const [diff, setDiff] = useState<ImportDiffResult | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [applying, setApplying] = useState(false)
  const [lastBackups, setLastBackups] = useState<string[] | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function loadFromText(name: string, text: string) {
    setLastBackups(null)
    setDiff(null)
    setSelectedKeys(new Set())
    try {
      const parsed = JSON.parse(text) as ExportBundle
      setBundle(parsed)
      setFileName(name)
    } catch {
      setBundle(null)
      setFileName(null)
      toast.error("JSONファイルの読み込みに失敗しました")
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    loadFromText(file.name, await file.text())
  }

  /**
   * 配布版exeで<input type="file">クリックがネイティブダイアログを開かない事例が
   * 報告されたため（項目6）、Electron上ではmain process側のdialog.showOpenDialogを
   * IPC経由で直接呼び出す。ブラウザ実行時（開発時）はwindow.electronAPIが存在しないため、
   * 従来どおり隠しinputのclickにフォールバックする。
   */
  async function handlePickFile() {
    if (window.electronAPI?.pickImportFile) {
      const result = await window.electronAPI.pickImportFile()
      if (!result) return
      if ("error" in result) {
        toast.error(`ファイルの読み込みに失敗しました: ${result.error}`)
        return
      }
      loadFromText(result.fileName, result.content)
      return
    }
    fileInputRef.current?.click()
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragLeave() {
    setIsDragOver(false)
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    loadFromText(file.name, await file.text())
  }

  async function handleComputeDiff() {
    if (!bundle) return
    setLoadingDiff(true)
    try {
      const result = await diffImport(bundle)
      setDiff(result)
      setSelectedKeys(
        new Set(
          result.items
            .filter((i) => i.status === "new" || i.status === "changed")
            .map((i) => itemKey(i))
        )
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "差分の取得に失敗しました")
    } finally {
      setLoadingDiff(false)
    }
  }

  function toggle(item: ImportDiffItem) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      const key = itemKey(item)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectAll() {
    if (!diff) return
    setSelectedKeys(new Set(diff.items.filter((i) => i.status !== "invalid").map((i) => itemKey(i))))
  }

  function clearAll() {
    setSelectedKeys(new Set())
  }

  function handleApplyClick() {
    if (!bundle || !diff) return
    const hasSelection = diff.items.some((i) => selectedKeys.has(itemKey(i)))
    if (!hasSelection) {
      toast.error("適用する項目を選択してください")
      return
    }
    if (isGlobalConfig) {
      setConfirmOpen(true)
      return
    }
    handleApply()
  }

  async function handleApply() {
    if (!bundle || !diff) return
    const ruleCategories = diff.items
      .filter((i) => i.kind === "rule" && selectedKeys.has(itemKey(i)))
      .map((i) => i.key)
    const skillDirNames = diff.items
      .filter((i) => i.kind === "skill" && selectedKeys.has(itemKey(i)))
      .map((i) => i.key)

    if (ruleCategories.length === 0 && skillDirNames.length === 0) {
      toast.error("適用する項目を選択してください")
      return
    }

    setConfirmOpen(false)
    setApplying(true)
    try {
      const result = await applyImport(bundle, { ruleCategories, skillDirNames })
      toast.success(`${ruleCategories.length + skillDirNames.length}件を適用しました`)
      setLastBackups(result.backups)
      setBundle(null)
      setFileName(null)
      setDiff(null)
      setSelectedKeys(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "適用に失敗しました")
    } finally {
      setApplying(false)
    }
  }

  const ruleItems = diff?.items.filter((i) => i.kind === "rule") ?? []
  const skillItems = diff?.items.filter((i) => i.kind === "skill") ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">インポート</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          他のPCでエクスポートしたJSONファイルを選択すると、現在のプロジェクトとの差分を確認してから、
          選択した項目だけを反映できます。上書きされるファイルは適用前に自動でバックアップされます。
        </p>

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`flex flex-col items-center gap-2 rounded-md border border-dashed p-4 text-center transition-colors ${
            isDragOver ? "border-primary bg-accent" : "border-border"
          }`}
        >
          <p className="text-xs text-muted-foreground">
            ここにJSONファイルをドラッグ&ドロップ、または
          </p>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={handlePickFile}>
              ファイルを選択
            </Button>
            {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {bundle && !diff && (
          <Button onClick={handleComputeDiff} disabled={loadingDiff}>
            {loadingDiff ? "確認中..." : "差分を確認"}
          </Button>
        )}

        {diff && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={selectAll}>
                全て選択
              </Button>
              <Button variant="outline" size="sm" onClick={clearAll}>
                全て解除
              </Button>
            </div>
            <ImportDiffList title="ルール" items={ruleItems} selectedKeys={selectedKeys} onToggle={toggle} />
            <ImportDiffList title="スキル" items={skillItems} selectedKeys={selectedKeys} onToggle={toggle} />
            <Button onClick={handleApplyClick} disabled={applying}>
              {applying ? "適用中..." : `選択した${selectedKeys.size}件を適用`}
            </Button>
          </div>
        )}

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="グローバル設定を上書きします"
          description="適用先は実際の ~/.claude（グローバル設定）です。選択した項目がClaude Code本体の設定に直接反映されます。上書きされる既存ファイルは自動でバックアップされますが、続行しますか？"
          confirmLabel="上書きを実行する"
          onConfirm={handleApply}
          confirming={applying}
        />

        {lastBackups && (
          <Alert>
            <AlertTitle>適用が完了しました</AlertTitle>
            <AlertDescription>
              {lastBackups.length > 0 ? (
                <>
                  上書きされたファイルは以下にバックアップされました：
                  <ul className="mt-1 list-inside list-disc font-mono text-xs">
                    {lastBackups.map((b) => (
                      <li key={b} className="truncate">
                        {b}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                "新規追加のみのためバックアップは作成されていません。"
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
