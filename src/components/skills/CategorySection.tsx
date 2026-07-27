"use client"

import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface CategorySectionProps {
  emoji: string
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
  children: ReactNode
}

export function CategorySection({ emoji, label, count, expanded, onToggle, children }: CategorySectionProps) {
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
      >
        <ChevronRight className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-90")} />
        {emoji} {label}（{count}）
      </button>
      {expanded && children}
    </section>
  )
}
