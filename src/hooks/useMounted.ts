"use client"

import { useSyncExternalStore } from "react"

const emptySubscribe = () => () => {}

/**
 * next-themesのuseTheme()はlocalStorage保存済みの値を初回クライアントレンダーで
 * 同期的に読み込むため、サーバー側の描画と食い違いHydration Mismatchを起こす。
 * useState+useEffect(react-hooks/set-state-in-effect対象)を避け、
 * useSyncExternalStoreのgetServerSnapshotでサーバーと同じ初期値を保証する。
 */
export function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}
