"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"

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
  return (
    <div className="space-y-2">
      <ul className="space-y-2" aria-label={label}>
        {shown.map((item) => (
          <li key={keyOf(item)}>{renderItem(item)}</li>
        ))}
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
