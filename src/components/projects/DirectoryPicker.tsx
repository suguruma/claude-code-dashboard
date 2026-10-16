"use client"

import { useState } from "react"
import { ChevronUp, X } from "lucide-react"
import { useDirBrowser, useFilePreview } from "@/hooks/useDirBrowser"
import { DirectoryTreeNode } from "./DirectoryTreeNode"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface DirectoryPickerProps {
  onConfirm: (path: string) => void
}

export function DirectoryPicker({ onConfirm }: DirectoryPickerProps) {
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const { path, parentPath, entries, shortcuts, isLoading, error } = useDirBrowser(rootPath)
  const preview = useFilePreview(previewPath)

  function navigateTo(p: string | null) {
    setRootPath(p)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {shortcuts.map((s) => (
          <Button
            key={s.path}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigateTo(s.path)}
          >
            {s.label}
          </Button>
        ))}
        {parentPath && (
          <Button type="button" variant="outline" size="sm" onClick={() => navigateTo(parentPath)}>
            <ChevronUp className="size-3.5" />
            上へ
          </Button>
        )}
      </div>

      <p className="truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
        {path ?? "ドライブを選択してください"}
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <ScrollArea className="h-64 rounded-md border p-1">
        {isLoading && <p className="p-2 text-xs text-muted-foreground">読み込み中...</p>}
        {!isLoading && entries.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">フォルダがありません</p>
        )}
        {entries.map((entry) => (
          <DirectoryTreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            previewPath={previewPath}
            onPreviewFile={setPreviewPath}
          />
        ))}
      </ScrollArea>

      {previewPath && (
        <div className="rounded-md border">
          <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-2 py-1">
            <p className="min-w-0 flex-1 truncate font-mono text-xs">{previewPath}</p>
            <button
              type="button"
              onClick={() => setPreviewPath(null)}
              aria-label="プレビューを閉じる"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <ScrollArea className="h-32">
            <div className="p-2">
              {preview.isLoading && <p className="text-xs text-muted-foreground">読み込み中...</p>}
              {preview.error && <p className="text-xs text-destructive">{preview.error.message}</p>}
              {!preview.isLoading && !preview.error && preview.binary && (
                <p className="text-xs text-muted-foreground">
                  テキストとして表示できないファイルです（プレビュー非対応）
                </p>
              )}
              {!preview.isLoading && !preview.error && !preview.binary && (
                <>
                  <pre className="text-xs whitespace-pre-wrap break-all">
                    {preview.content || "（空のファイルです）"}
                  </pre>
                  {preview.truncated && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      ファイルが大きいため、先頭部分のみ表示しています
                    </p>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {selectedPath ? `選択中: ${selectedPath}` : "ツリー内のフォルダをクリックして選択してください"}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={!selectedPath}
          onClick={() => selectedPath && onConfirm(selectedPath)}
        >
          このフォルダを使う
        </Button>
      </div>
    </div>
  )
}
