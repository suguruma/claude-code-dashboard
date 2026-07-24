"use client"

import { useState } from "react"
import { ChevronUp } from "lucide-react"
import { useDirBrowser } from "@/hooks/useDirBrowser"
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
  const { path, parentPath, entries, shortcuts, isLoading, error } = useDirBrowser(rootPath)

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
          />
        ))}
      </ScrollArea>

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
