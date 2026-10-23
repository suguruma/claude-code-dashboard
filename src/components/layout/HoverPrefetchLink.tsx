"use client"

import { useState, type ComponentProps } from "react"
import Link, { useLinkStatus } from "next/link"
import { cn } from "@/lib/utils"

/**
 * 押しそうなときだけ先読みするリンク(⑫ ST-4)。ポインタが乗ったとき・キーボードのフォーカスが来たときに先読みを始める。
 * 画面に入っただけでは先読みしない(起動のときに、サイドバーの全部のページをサーバーに描かせない)。
 * 形は Next 16.2 の資料(linking-and-navigating.md の「hover だけで先読みする」)と同じ。
 */
export function HoverPrefetchLink({ onMouseEnter, onFocus, ...props }: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [active, setActive] = useState(false)
  return (
    <Link
      {...props}
      prefetch={active ? null : false}
      onMouseEnter={(e) => {
        setActive(true)
        onMouseEnter?.(e)
      }}
      onFocus={(e) => {
        setActive(true)
        onFocus?.(e)
      }}
    />
  )
}

/**
 * 押した直後から移り終わるまでの「移動中…」(⑫ ST-4)。Link の中に置く(useLinkStatus は、いちばん近い Link の状態を返す)。
 * 100ミリ秒より速く移れたときは見えない(CSS の遅れ。動きを減らす設定でも、出る・消えるだけで動かない)
 */
export function LinkPendingHint({ className }: { className?: string }) {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return (
    <span className={cn("link-pending-hint ml-auto shrink-0 text-sm text-muted-foreground", className)} data-testid="link-pending">
      移動中…
    </span>
  )
}
