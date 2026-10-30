"use client"

import { Suspense } from "react"
import { SessionDetailDialog } from "@/components/desktopSessions/SessionDetailDialog"
import { useSelectSession, useSelectedSessionId } from "@/hooks/useSelectedSession"

/**
 * `?session=` で選んだセッションの詳細のダイアログ。`?session=` を読む部分だけを小さな Suspense に入れる。
 * ページ全体を Suspense で包むと、静的な HTML に中身が入らず(⑫ ST-6)、開発版(next dev)では中身のハイドレーションが
 * 画面の描画を待つので、描画の止まった窓では一覧の取得が始まらない(⑬ 段2・段3 の不具合)。
 * ページの側は、選ぶ(useSelectSession)だけを使い、useSearchParams を使わない。
 */
export function SelectedSessionDialog({ highContextRatio }: { highContextRatio: number }) {
  return (
    <Suspense fallback={null}>
      <DialogFromUrl highContextRatio={highContextRatio} />
    </Suspense>
  )
}

function DialogFromUrl({ highContextRatio }: { highContextRatio: number }) {
  const selectedId = useSelectedSessionId()
  const setSelectedId = useSelectSession()
  return <SessionDetailDialog sessionId={selectedId} highContextRatio={highContextRatio} onClose={() => setSelectedId(null)} />
}
