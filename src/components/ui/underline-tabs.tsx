"use client"

import { useRef, type KeyboardEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * 下線つきのタブ(⑬ 組織の［決まり］［つながり］。⑭ のリソースでも使う)。
 * 選んでいる値は呼ぶ側が持つ(`useTabParam` で `?tab=` と前回の選択に結ぶ)。
 * キー操作は WAI-ARIA のタブの決まりどおり：←→ で隣へ移り、Home・End で端へ。移ると同時に選ぶ。
 */
export interface UnderlineTab<T extends string> {
  id: T
  label: ReactNode
}

export function tabElementId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`
}

export function tabPanelId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`
}

export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  idPrefix,
  label,
  className,
}: {
  tabs: ReadonlyArray<UnderlineTab<T>>
  value: T
  onChange: (id: T) => void
  /** タブとパネルの id の頭(ページの中で重ならない名前) */
  idPrefix: string
  /** タブの並びの名前(読み上げ用) */
  label: string
  className?: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const move = (index: number) => {
    const next = (index + tabs.length) % tabs.length
    onChange(tabs[next].id)
    refs.current[next]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === "ArrowRight") move(index + 1)
    else if (e.key === "ArrowLeft") move(index - 1)
    else if (e.key === "Home") move(0)
    else if (e.key === "End") move(tabs.length - 1)
    else return
    e.preventDefault()
  }

  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-4 border-b", className)}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="tab"
            id={tabElementId(idPrefix, tab.id)}
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "-mb-px min-h-11 border-b-2 px-1 text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/** タブに結んだパネル。選ばれていないパネルは描かない */
export function UnderlineTabPanel({
  idPrefix,
  id,
  value,
  children,
}: {
  idPrefix: string
  id: string
  value: string
  children?: ReactNode
}) {
  if (id !== value) return null
  return (
    <div role="tabpanel" id={tabPanelId(idPrefix, id)} aria-labelledby={tabElementId(idPrefix, id)} tabIndex={0} className="outline-none">
      {children}
    </div>
  )
}
