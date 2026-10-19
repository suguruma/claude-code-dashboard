"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useSelectedLayoutSegments } from "next/navigation"
import { useTheme } from "next-themes"
import { SWRConfig, useSWRConfig } from "swr"
import { Gauge, House, ListChecks, ListTree, Lock, RefreshCw, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { PhoneSessionSheet } from "./PhoneSessionSheet"
import { useOpenSessionId } from "./sessionHash"

interface PhoneTab {
  href: string
  /** app/phone の下の、このページの区切り(useSelectedLayoutSegments の値) */
  segments: string[]
  label: string
  title: string
  Icon: LucideIcon
}

/** 下の4つのタブ(ホーム・一覧・上限・整理)。URL は PC と同じ4ページ */
export const PHONE_TABS: PhoneTab[] = [
  { href: "/", segments: [], label: "ホーム", title: "ホーム", Icon: House },
  { href: "/desktop-sessions", segments: ["desktop-sessions"], label: "一覧", title: "セッション一覧", Icon: ListTree },
  { href: "/desktop-sessions/usage", segments: ["desktop-sessions", "usage"], label: "上限", title: "利用上限", Icon: Gauge },
  {
    href: "/desktop-sessions/housekeeping",
    segments: ["desktop-sessions", "housekeeping"],
    label: "整理",
    title: "セッションの整理",
    Icon: ListChecks,
  },
]

function sameSegments(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
}

/**
 * スマホ用のページ(⑪-2)の枠。上のバー(ページの名前・読み取り専用の印・最後に更新した時刻・更新のボタン)と、
 * 下の4つのタブ。ノッチ(safe-area)をよける。テーマはスマホの設定に合わせる(Q17。切り替えのボタンは出さない)。
 * 詳細のシート(`#session=`)は、どのページでもここで開く。
 */
export function PhoneShell({ children }: { children: ReactNode }) {
  const segments = useSelectedLayoutSegments()
  const current = PHONE_TABS.find((t) => sameSegments(t.segments, segments)) ?? null
  const openId = useOpenSessionId()
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const { mutate } = useSWRConfig()
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    // PC と違い、スマホでは端末の設定(ライト・ダーク)に合わせる。前にスマホで選んだテーマが残っていれば戻す
    if (theme && theme !== "system") setTheme("system")
  }, [theme, setTheme])

  const swrValue = useMemo(() => ({ onSuccess: () => setUpdatedAt(Date.now()) }), [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await mutate((key) => typeof key === "string" && key.startsWith("/api/"))
    } finally {
      setRefreshing(false)
    }
  }, [mutate])

  return (
    <SWRConfig value={swrValue}>
      <div className="min-h-dvh bg-background text-base text-foreground" data-testid="phone-shell">
        {/* 開発のサーバー(next dev)の Next の印・エラーの表示は、画面の左下に出て、下のタブ(ホーム)に重なるので、スマホでは出さない(本番には無い) */}
        <style>{"nextjs-portal{display:none!important}"}</style>
        <header className="sticky top-0 z-30 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="mx-auto flex min-h-14 max-w-xl items-center gap-2 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
            <div className="min-w-0 flex-1 py-1">
              <h1 className="truncate text-lg leading-tight font-semibold">{current?.title ?? "Claude Code Dashboard"}</h1>
              <p className="flex flex-wrap items-center gap-x-2 text-[0.8125rem] leading-snug text-muted-foreground">
                <span
                  className="inline-flex items-center gap-0.5 rounded-full border px-1.5"
                  data-testid="phone-readonly-badge"
                  title="スマホからは見るだけです。設定の変更は PC の画面から行います。"
                >
                  <Lock className="size-3.5" aria-hidden />
                  読み取り専用
                </span>
                <span data-testid="phone-updated">{updatedAt === null ? "更新を待っています" : `${formatClock(updatedAt)} に更新`}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              aria-label="今すぐ更新"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              data-testid="phone-refresh"
            >
              <RefreshCw className={cn("size-5", refreshing && "animate-spin")} aria-hidden />
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-xl pt-4 pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(3.5rem+env(safe-area-inset-bottom)+1.5rem)] pl-[max(1rem,env(safe-area-inset-left))]">
          {children}
        </main>

        <nav aria-label="ページ" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)]" data-testid="phone-tabs">
          <ul className="mx-auto grid max-w-xl grid-cols-4 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
            {PHONE_TABS.map((tab) => {
              const active = tab === current
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.8125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      active ? "font-semibold text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <tab.Icon className={cn("size-6", active && "text-primary")} aria-hidden />
                    {tab.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {openId && <PhoneSessionSheet key={openId} sessionId={openId} />}
      </div>
    </SWRConfig>
  )
}
