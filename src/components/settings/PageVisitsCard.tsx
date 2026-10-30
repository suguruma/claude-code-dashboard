"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { findNavItem } from "@/components/layout/navConfig"
import { usePageVisits } from "@/hooks/usePageVisits"
import { summarizePageVisits } from "@/lib/pageVisits"

/** 「開いた回数を数える」のスイッチと、直近30日の回数の表(⑬ FS-7)。プロジェクトを選んでいなくても出す */
export function PageVisitsCard() {
  const { enabled, visits, loaded, error, setEnabled } = usePageVisits()
  const [busy, setBusy] = useState(false)
  // 表の「今日」は、ページを開いたときの日(開き直せば次の日になる)
  const [now] = useState(() => Date.now())
  const rows = summarizePageVisits(visits, now)
  const counted = rows.some((r) => r.last30 > 0)

  async function handleChange(next: boolean) {
    setBusy(true)
    try {
      await setEnabled(next)
      toast.success(next ? "ページを開いた回数を数えます" : "ページを開いた回数を数えるのをやめました（数えた結果は残します）")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "設定を保存できませんでした")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">ページを開いた回数</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Switch
            id="page-visits"
            checked={enabled}
            disabled={!loaded || busy}
            onCheckedChange={(checked) => void handleChange(checked)}
          />
          <Label htmlFor="page-visits" className="text-sm">
            開いた回数を数える
          </Label>
        </div>
        <p className="text-sm text-muted-foreground">
          サイドバーの13ページだけを、1日に1回（同じ日に何度開いても1回）数えます。残すのはページと日付ごとの回数だけで、直近30日より前は消します。このアプリの中だけに保存し、外部へは送りません（初期値はオン）。
        </p>
        {error && <p className="text-sm text-destructive">回数を読み込めませんでした：{error.message}</p>}
        {loaded && !counted && <p className="text-sm text-muted-foreground">まだ数えた回数はありません。</p>}
        {counted && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">ページ</th>
                  <th className="py-1.5 pr-3 text-right font-medium">直近7日</th>
                  <th className="py-1.5 pr-3 text-right font-medium">直近30日</th>
                  <th className="py-1.5 font-medium">最後に開いた日</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.path} className="border-b last:border-b-0">
                    <td className="py-1.5 pr-3">{findNavItem(row.path)?.label ?? row.path}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{row.last7}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{row.last30}</td>
                    <td className="py-1.5 tabular-nums text-muted-foreground">{row.lastDate ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
