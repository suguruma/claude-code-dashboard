"use client"

import { useCallback, useSyncExternalStore } from "react"

type Listener = () => void
const listeners = new Map<string, Set<Listener>>()

function subscribe(key: string, listener: Listener): () => void {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key)!.add(listener)
  return () => listeners.get(key)?.delete(listener)
}

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l())
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * localStorageに永続化されるstate。useSyncExternalStoreを使い、ハイドレーション不一致
 * （サーバーは常にinitialを返し、クライアントは保存値を読む差異）を安全に扱う。
 */
export function usePersistedState<T>(key: string, initial: T): [T, (value: T) => void] {
  const getSnapshot = useCallback(() => readRaw(key), [key])
  const getServerSnapshot = useCallback(() => null, [])
  const subscribeToKey = useCallback((listener: Listener) => subscribe(key, listener), [key])

  const raw = useSyncExternalStore(subscribeToKey, getSnapshot, getServerSnapshot)

  let value = initial
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T
    } catch {
      value = initial
    }
  }

  const setValue = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // localStorageが使えない環境では永続化のみ諦める
      }
      notify(key)
    },
    [key]
  )

  return [value, setValue]
}
