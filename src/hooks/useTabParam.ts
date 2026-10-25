"use client"

import { useCallback, useSyncExternalStore } from "react"
import { usePersistedState } from "./useLocalStorage"

/** タブを替えたときに、同じページの useTabParam へ知らせるイベント(replaceState は popstate を出さないため) */
const TAB_CHANGE_EVENT = "ccd:tab-param"

function subscribeUrl(listener: () => void): () => void {
  window.addEventListener("popstate", listener)
  window.addEventListener(TAB_CHANGE_EVENT, listener)
  return () => {
    window.removeEventListener("popstate", listener)
    window.removeEventListener(TAB_CHANGE_EVENT, listener)
  }
}

const readUrlTab = (): string | null => new URLSearchParams(window.location.search).get("tab")
/** サーバーの描画とハイドレーションの間は、URL をまだ読んでいない(undefined) */
const readServerTab = (): string | null | undefined => undefined

/**
 * 選んでいるタブを、URL の `?tab=` と前回の選択(localStorage)に結ぶ。
 * URL に正しい値があればそれを使い、無ければ前回の選択、それも無ければ最初のタブ。
 * URL は useSearchParams ではなく location から読む。useSearchParams はページを Suspense で包む必要があり、
 * 開発版(next dev)では Suspense の中身のハイドレーションが画面の描画を待つので、描画の止まった窓では
 * タブの中身の取得が始まらなかった(⑬ 段2 の不具合)。
 * URL を読むまで(サーバーの描画とハイドレーションの間)は null を返す。呼ぶ側は、その間タブの中身を出さない。
 */
export function useTabParam<T extends string>(storageKey: string, allowed: ReadonlyArray<T>): [T | null, (tab: T) => void] {
  const [remembered, setRemembered] = usePersistedState<string | null>(storageKey, null)
  const fromUrl = useSyncExternalStore(subscribeUrl, readUrlTab, readServerTab)

  const setValue = useCallback(
    (tab: T) => {
      setRemembered(tab)
      const next = new URLSearchParams(window.location.search)
      next.set("tab", tab)
      // Next.js は history.replaceState を自分のルーターに取り込む(usePathname・useSearchParams も追従する)
      window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`)
      window.dispatchEvent(new Event(TAB_CHANGE_EVENT))
    },
    [setRemembered]
  )

  if (fromUrl === undefined) return [null, setValue]
  const pick = (v: string | null): T | null => (v !== null && (allowed as ReadonlyArray<string>).includes(v) ? (v as T) : null)
  return [pick(fromUrl) ?? pick(remembered) ?? allowed[0], setValue]
}
