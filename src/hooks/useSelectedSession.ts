"use client"

import { useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

/**
 * 詳細を開いているセッションは、URLの `?session=` で持つ。通知のクリックや組織図のカードから、そのセッションの詳細を直接開ける。
 * useSearchParams を使うため、呼び出す側のページは Suspense で包むこと(静的生成のため)。
 */
export function useSelectedSession(): [string | null, (id: string | null) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get("session")
  const setSelectedId = useCallback(
    (id: string | null) => {
      router.replace(id ? `${pathname}?session=${encodeURIComponent(id)}` : pathname, { scroll: false })
    },
    [router, pathname]
  )
  return [selectedId, setSelectedId]
}
