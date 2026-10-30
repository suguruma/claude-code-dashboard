"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { UsageContributions } from "@/components/desktopSessions/UsageContributions"
import { UsageGauge } from "@/components/desktopSessions/UsageGauge"
import { useUsage } from "@/hooks/useUsage"
import { costPerPercentOf, formatDollars, formatJst } from "@/lib/usageFormat"
import type { UsageResponse } from "@/lib/usageTypes"

function extraUsageText(extra: UsageResponse["extraUsage"]): string | null {
  if (!extra) return null
  if (!extra.enabled) return "追加利用：オフ（上限に達するとそこで止まります）"
  return `追加利用：オン${extra.spent !== null ? `（今月 ${formatDollars(extra.spent)}）` : ""}。100%に達しても止まらず、課金が始まります`
}

/**
 * 利用上限(5時間・週・週のモデル別)のゲージと、誰が使っているかの積み上げ棒。
 * 公式値(記録の読み取り)と、会話記録からの推定を並べ、推定には「推定」と明示する。読み取り専用。
 * showTitle=false は、ページの見出しが同じ「利用上限」のとき、見出しの重複を避ける。
 */
export function UsagePanel({ showTitle = true }: { showTitle?: boolean }) {
  const { data, error } = useUsage()

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>利用上限を取得できません</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }
  if (!data) return <p className="text-sm text-muted-foreground">利用上限を読み込み中...</p>

  const extra = extraUsageText(data.extraUsage)
  // 積み上げ棒の「上限の何%」に使う係数。5時間の棒は5時間の窓、今週の棒は週(全モデル)の窓の較正から
  const coefficientOfWindow = (key: string) => costPerPercentOf(data.windows.find((w) => w.id === key)?.calibration ?? null)
  return (
    <section className="space-y-3" aria-label="利用上限">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {showTitle ? <h2 className="text-base font-semibold">利用上限</h2> : <span />}
        <p className="text-xs text-muted-foreground">
          {data.snapshots.found && data.snapshots.lastRecordedAt !== null
            ? `公式値の最新の記録: ${formatJst(data.snapshots.lastRecordedAt)}${data.snapshots.plan ? `（${data.snapshots.plan}プラン）` : ""}`
            : "公式値の記録なし"}
        </p>
      </div>

      {!data.snapshots.found && (
        <Alert>
          <AlertTitle>公式値の記録が見つかりません</AlertTitle>
          <AlertDescription>
            公式値は <code className="font-mono">~/.claude-dashboard/usage-snapshots.jsonl</code> から読み取ります。
            記録が無いあいだは、ゲージは出せず、下の「誰が使っているか」だけを会話記録から表示します。
          </AlertDescription>
        </Alert>
      )}

      {data.windows.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {data.windows.map((w) => (
            <UsageGauge key={w.id} window={w} now={data.generatedAt} />
          ))}
        </div>
      )}

      {extra && <p className="text-xs text-muted-foreground">{extra}</p>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <UsageContributions title="直近5時間" set={data.contributions.fiveHour} costPerPercent={coefficientOfWindow("five_hour")} />
        <UsageContributions title="今週" set={data.contributions.week} costPerPercent={coefficientOfWindow("weekly_all")} />
      </div>

      {data.unregisteredModels.length > 0 && (
        <Alert>
          <AlertTitle>価格未登録のモデルあり</AlertTitle>
          <AlertDescription>
            {data.unregisteredModels.join("、")} は価格表にないため、opusの価格で仮に計算しています。
            <code className="font-mono"> config/usage.json</code> の <code className="font-mono">prices</code> で追加できます。
          </AlertDescription>
        </Alert>
      )}

      {/* 推定と公式値の差(中央値・90%点)は作る側の確かめなので出さない(⑬ の棚卸しの行19。確かめは自動テストで行う) */}
      <p className="text-xs text-muted-foreground">{data.note}</p>
    </section>
  )
}
