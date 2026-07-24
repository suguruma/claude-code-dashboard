"use client"

import { useState } from "react"
import { ChevronRight, ChevronDown, Folder, File as FileIcon, Loader2 } from "lucide-react"
import type { DirEntry } from "@/lib/dirBrowser"
import { useDirBrowser } from "@/hooks/useDirBrowser"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface DirectoryTreeNodeProps {
  entry: DirEntry
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
}

export function DirectoryTreeNode({ entry, depth, selectedPath, onSelect }: DirectoryTreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const isDir = entry.type === "directory"
  const { entries, isLoading, error } = useDirBrowser(entry.path, expanded && isDir)
  const isSelected = selectedPath === entry.path

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm hover:bg-accent",
          isSelected && "bg-accent font-medium"
        )}
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
      >
        {isDir ? (
          <button
            type="button"
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "折りたたむ" : "展開する"}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}

        <button
          type="button"
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 truncate text-left",
            !isDir && "cursor-default text-muted-foreground"
          )}
          onClick={() => isDir && onSelect(entry.path)}
          disabled={!isDir}
        >
          {isDir ? (
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{entry.name}</span>
        </button>

        {entry.isNotable && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {entry.name === "skills" ? "スキル" : "検出対象"}
          </Badge>
        )}
      </div>

      {expanded && isDir && (
        <div>
          {isLoading && (
            <div
              className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 16 + 6}px` }}
            >
              <Loader2 className="size-3 animate-spin" />
              読み込み中...
            </div>
          )}
          {error && (
            <p
              className="py-1 text-xs text-destructive"
              style={{ paddingLeft: `${(depth + 1) * 16 + 6}px` }}
            >
              {error.message}
            </p>
          )}
          {entries.map((child) => (
            <DirectoryTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
