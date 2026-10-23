"use client"

import { useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

/**
 * 詳細を開いているセッションは、URLの `?session=` で持つ。通知のクリックや組織図のカードから、そのセッションの詳細を直接開ける。
 * useSearchParams を使うため、呼び出す側のページは Suspense で包むこと(静的生成のため)。
 */
export function useSelectedSession(): [string | null, (id: string | null) => void] {
  const selectedId = useSelectedSessionId()
  const setSelectedId = useSelectSession()
  return [selectedId, setSelectedId]
}

/**
 * 選ぶ側だけ(`?session=` を書く)。useSearchParams を使わないので、呼んでもページが画面の側での描画に回らない。
 * ホームは、読む側(useSelectedSessionId)だけを小さな Suspense に入れ、ほかを静的な HTML に入れる(⑫ ST-6)
 */
export function useSelectSession(): (id: string | null) => void {
  const router = useRouter()
  const pathname = usePathname()
  return useCallback(
    (id: string | null) => {
      router.replace(id ? `${pathname}?session=${encodeURIComponent(id)}` : pathname, { scroll: false })
    },
    [router, pathname]
  )
}

/** 読む側だけ(`?session=` を読む)。useSearchParams を使うので、いちばん近い Suspense までが画面の側での描画になる */
export function useSelectedSessionId(): string | null {
  return useSearchParams().get("session")
}
