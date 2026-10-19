"use client"

import { useState } from "react"
import { ChevronRight, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useOrgMemoryBody } from "@/hooks/useOrgRules"
import { formatJst } from "@/lib/usageFormat"
import type { OrgMemory, OrgMemoryEntry } from "@/lib/orgRulesTypes"
import { StaleRefList } from "./RuleFileView"

const MEMORY_STATUS_TEXT: Record<Exclude<OrgMemory["status"], "ok">, string> = {
  missing: "記憶はありません。",
  unknown: "記憶の場所が分かりません（指揮役の会話ログが見つかりません）。",
  wsl: "この PC からは読めません（WSL の作業フォルダ）。",
}

/** 指揮役の記憶の一覧。本文は、行を開いたときだけ取りに行く */
export function MemoryList({ folderKey, memory }: { folderKey: string; memory: OrgMemory }) {
  if (memory.status !== "ok") return <p className="text-sm text-muted-foreground">{MEMORY_STATUS_TEXT[memory.status]}</p>
  const types = Object.entries(memory.typeCounts).sort((a, b) => b[1] - a[1])
  return (
    <div className="space-y-2" data-testid="memory-list">
      <p className="text-xs text-muted-foreground">
        {memory.entries.length}件
        {types.length > 0 && `（${types.map(([t, n]) => `${t} ${n}`).join("・")}）`}
        {!memory.hasIndex && "。索引（MEMORY.md）はありません"}
      </p>
      {memory.missingFromDisk.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs" style={{ color: "var(--status-warning-text)" }} data-testid="memory-missing">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>索引（MEMORY.md）が指しているのに、無いファイル：{memory.missingFromDisk.join("・")}</span>
        </p>
      )}
      {memory.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">記憶のファイルはありません。</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {memory.entries.map((entry) => (
            <MemoryRow key={entry.fileName} folderKey={folderKey} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  )
}

function MemoryRow({ folderKey, entry }: { folderKey: string; entry: OrgMemoryEntry }) {
  const [open, setOpen] = useState(false)
  // 大きすぎる記憶は、本文を取りに行かず、開けない理由だけを出す
  const { data, error, isLoading } = useOrgMemoryBody(folderKey, entry.fileName, open && !entry.tooLarge)
  return (
    <li data-testid="memory-row">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/50"
      >
        <ChevronRight className={`mt-0.5 size-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="break-all">{entry.name}</span>
            <Badge variant="secondary">{entry.type}</Badge>
            {entry.staleCount > 0 && (
              <Badge variant="outline" className="gap-1">
                <TriangleAlert className="size-3" aria-hidden />
                古い名前の疑い {entry.staleCount}件
              </Badge>
            )}
            {entry.notInIndex && <Badge variant="outline">索引に無い</Badge>}
            {entry.tooLarge && <Badge variant="outline">大きすぎて開けない</Badge>}
          </span>
          {entry.description && <span className="block text-xs text-muted-foreground">{entry.description}</span>}
          <span className="block text-xs text-muted-foreground">
            {entry.fileName}
            {entry.updatedAt !== null && `・更新 ${formatJst(entry.updatedAt)}`}
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t bg-muted/30 px-3 py-2">
          {entry.tooLarge && (
            <p className="text-xs text-muted-foreground" data-testid="memory-too-large">
              256KB を超えるため、本文を開けません。
            </p>
          )}
          {isLoading && <p className="text-xs text-muted-foreground">読み込み中...</p>}
          {error && <p className="text-xs text-destructive">本文を読み込めませんでした。</p>}
          {data && (
            <>
              <p className="text-sm leading-relaxed whitespace-pre-wrap" data-testid="memory-body">
                {data.body || "（本文なし）"}
              </p>
              <StaleRefList refs={data.staleRefs} />
            </>
          )}
        </div>
      )}
    </li>
  )
}
