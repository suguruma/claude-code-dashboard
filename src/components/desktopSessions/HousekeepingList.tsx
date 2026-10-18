"use client"

import { useState, type MouseEvent, type ReactNode } from "react"
import { Button } from "@/components/ui/button"

/**
 * 行のボタン・リンク以外の場所を押しても、詳細を開く（行全体が押せる）。「セッションを開く」などのボタンの入れ子を避けるため、
 * 行の枠の onClick で受ける。文字を選択しているとき（コピーのためのドラッグ）は開かない。キーボードでは、行のタイトルのボタンで開く。
 */
export function openOnRowClick(onSelect: (id: string) => void, id: string) {
  return (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, a")) return
    if (typeof window !== "undefined" && (window.getSelection()?.toString() ?? "") !== "") return
    onSelect(id)
  }
}

/** 件数が多いときの既定の表示件数(残りは「すべて表示」で開く) */
export const HOUSEKEEPING_PREVIEW_COUNT = 20

/**
 * 一覧の枠。件数が limit を超えるときは、先頭の limit 件だけを出し、「すべて表示（n件）」で残りを開く。
 * 並びは呼び出し側で決めた順(重要なものが先頭)のまま。
 */
export function LimitedList<T>({
  items,
  limit = HOUSEKEEPING_PREVIEW_COUNT,
  renderItem,
  keyOf,
  label,
}: {
  items: T[]
  limit?: number
  renderItem: (item: T) => ReactNode
  keyOf: (item: T) => string
  /** 一覧の名前（「すべて表示」ボタンの読み上げ用） */
  label: string
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? items : items.slice(0, limit)
  const hidden = items.length - shown.length
  // keyOf が同じ値になる項目（同じ時刻の指示など）があっても、キーが重ならないようにする
  const seen = new Map<string, number>()
  return (
    <div className="space-y-2">
      <ul className="space-y-2" aria-label={label}>
        {shown.map((item) => {
          const base = keyOf(item)
          const n = seen.get(base) ?? 0
          seen.set(base, n + 1)
          return <li key={n === 0 ? base : `${base}#${n}`}>{renderItem(item)}</li>
        })}
      </ul>
      {items.length > limit && (
        <Button type="button" variant="outline" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? `上位${limit}件だけを表示` : `すべて表示（残り${hidden}件）`}
        </Button>
      )}
    </div>
  )
}

/** 節の見出し。件数を添える */
export function SectionHeading({ id, title, count, description }: { id: string; title: string; count: number; description: string }) {
  return (
    <div className="space-y-1">
      <h2 id={id} className="flex items-baseline gap-2 text-base font-semibold">
        {title}
        <span className="text-sm font-normal text-muted-foreground tabular-nums">{count}件</span>
      </h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">{children}</p>
}
