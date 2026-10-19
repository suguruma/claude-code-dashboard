"use client"

import { useSyncExternalStore } from "react"
import { parseSessionHash, sessionHash } from "@/lib/phoneView"

/**
 * 詳細のシートで開いているセッション(Q19)。URL のパスは変えず、`#session=<ID>` で持つ(入り口の許可リストを増やさない)。
 * 開くときは履歴を1つ積むので、ブラウザの戻るで閉じる。シートの「戻る」も、自分で積んだ履歴なら戻るで閉じる。
 */

/** このページで積んだ履歴か(直接 `#session=` の URL を開いたときは、戻ると前のサイトへ出てしまうので、戻らずに消す) */
let pushedHere = false

/** URL の `#` の変化(開く・ブラウザの戻る・閉じる)を知らせる。絞り込みのシートも使う */
export function subscribeLocation(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange)
  window.addEventListener("popstate", onChange)
  return () => {
    window.removeEventListener("hashchange", onChange)
    window.removeEventListener("popstate", onChange)
  }
}

export function useOpenSessionId(): string | null {
  const hash = useSyncExternalStore(
    subscribeLocation,
    () => window.location.hash,
    () => ""
  )
  return parseSessionHash(hash)
}

export function openSession(id: string): void {
  pushedHere = true
  window.location.hash = sessionHash(id)
}

export function closeSession(): void {
  if (pushedHere) {
    pushedHere = false
    window.history.back()
    return
  }
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search)
  window.dispatchEvent(new HashChangeEvent("hashchange"))
}
