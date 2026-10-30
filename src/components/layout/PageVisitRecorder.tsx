"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { usePageVisits } from "@/hooks/usePageVisits"
import { apiMutate } from "@/lib/fetcher"
import { PageVisitTracker } from "@/lib/pageVisitTracker"

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** ページを開いた回数を数える(⑬ FS-7)。設定で「開いた回数を数える」がオンのときだけ、このアプリのサーバーへ送る */
export function PageVisitRecorder() {
  const pathname = usePathname()
  const { enabled } = usePageVisits()
  const trackerRef = useRef<PageVisitTracker | null>(null)

  useEffect(() => {
    if (!enabled || !pathname) return
    trackerRef.current ??= new PageVisitTracker({
      now: Date.now,
      send: async (visits) => {
        await apiMutate("/api/page-visits", "POST", { visits })
      },
      schedule: (fn, ms) => {
        window.setTimeout(fn, ms)
      },
      storage: browserStorage(),
    })
    trackerRef.current.visit(pathname)
  }, [enabled, pathname])

  return null
}
