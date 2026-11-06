"use client"

import type { SWRConfiguration } from "swr"
import { buildMarks, type StatusMark } from "@/lib/statusMark"
import { useDesktopSessions } from "./useDesktopSessions"

/**
 * 一覧の全セッションの状態の印(⑮ OR-2)。セッション一覧と同じ取得(SWR の同じキー)を読むので、同じページで何度呼んでも
 * 要求は増えない。時刻は一覧を作った時刻(generatedAt)を使い、どの画面でも同じセッションに同じ印が出るようにする
 */
export function useStatusMarks(options?: SWRConfiguration): Map<string, StatusMark> | null {
  const { data } = useDesktopSessions(true, options)
  return data ? buildMarks(data.sessions, data.generatedAt) : null
}
