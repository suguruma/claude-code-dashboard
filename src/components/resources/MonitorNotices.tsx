"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/home/HomeLoading"

/**
 * リソースのページ(⑭)の［作業と待ち］［負荷］で共通の、設定が無いとき・読み込み中・取れないときの表示(WC-14。⑬ の A10 と同じ形)。
 */

/** 設定が無いとき(WC-8)。エラーにせず、書き方の案内を出す */
export function MonitorSetupNotice() {
  return (
    <div className="space-y-2 rounded-xl p-4 text-sm ring-1 ring-foreground/10" data-testid="monitor-setup">
      <p>
        見張りの記録の場所が設定されていません。<code>config/monitor.json</code> に3つのファイルの場所を書くと、ここに出ます。書き方の見本：
        <code>config/monitor.example.json</code>
      </p>
      <Link href="/help#monitor-config" className="inline-flex min-h-11 items-center text-primary hover:underline">
        設定の書き方を見る
      </Link>
    </div>
  )
}

/** 読み込み中：行の骨組み(高さを決めた灰色。動かさない) */
export function MonitorSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" data-testid="monitor-skeleton">
      <span className="sr-only">読み込んでいます</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  )
}

/** 取れないとき：［もう一度読み込む］(読み込みが終わってからだけ出す) */
export function MonitorLoadError({ text, onRetry, busy }: { text: string; onRetry: () => void; busy: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="monitor-error">
      <span role="status" style={{ color: "var(--status-critical-text)" }}>
        {text}
      </span>
      <Button variant="outline" className="text-sm" onClick={onRetry} disabled={busy}>
        もう一度読み込む
      </Button>
    </div>
  )
}
