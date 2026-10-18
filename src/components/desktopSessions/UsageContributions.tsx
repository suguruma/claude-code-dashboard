import { formatLimitShare, formatPercent, formatTokens } from "@/lib/usageFormat"
import type { UsageContribution, UsageContributionSet } from "@/lib/usageTypes"

const NO_GROUP = "グループなし"
/** 1つのグループ内でセッションを塗り分ける濃さ(同じ色相の濃淡。色だけに頼らないよう、境界に隙間を入れる) */
const SHADES = [0.85, 0.6, 0.4, 0.25]

interface GroupBar {
  name: string
  total: number
  items: UsageContribution[]
}

function groupBars(items: UsageContribution[]): GroupBar[] {
  const groups = new Map<string, GroupBar>()
  for (const item of items) {
    const name = item.groupName ?? NO_GROUP
    const bar = groups.get(name) ?? { name, total: 0, items: [] }
    bar.total += item.costUsd
    bar.items.push(item)
    groups.set(name, bar)
  }
  const bars = [...groups.values()]
  for (const bar of bars) bar.items.sort((a, b) => b.costUsd - a.costUsd)
  return bars.sort((a, b) => b.total - a.total)
}

function totalTokens(item: UsageContribution): number {
  return item.tokens.input + item.tokens.output + item.tokens.cacheRead + item.tokens.cacheWrite
}

/**
 * セッション別・グループ別の消費の積み上げ棒。棒の長さは、金額換算(=上限への寄与)。
 * 生のトークン数ではキャッシュ読み取りが大半を占め、上限への寄与とずれるため、金額換算で並べる。
 * 値は、ドルではなく「上限の何%」(金額÷1%あたりの金額)で表示する。定額プランでは、ドルの表示が請求額と誤解されるため。
 * 1%あたりの金額(costPerPercent)が決まらないときは、全体に占める割合で表示する。
 */
export function UsageContributions({
  title,
  set,
  costPerPercent,
}: {
  title: string
  set: UsageContributionSet
  costPerPercent: number | null
}) {
  const bars = groupBars(set.items)
  const grand = bars.reduce((sum, b) => sum + b.total, 0)
  const max = bars[0]?.total ?? 0
  const share = (cost: number) => formatLimitShare(cost, grand, costPerPercent)

  return (
    <section className="space-y-2 rounded-xl p-4 ring-1 ring-foreground/10" aria-label={`${title}の消費`}>
      <h3 className="text-sm font-medium">
        {title}の消費
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {costPerPercent !== null ? `合計 ${share(grand)}（推定）` : "上限に対する割合は未確定（全体に占める割合で表示）"}
        </span>
      </h3>
      {bars.length === 0 ? (
        <p className="text-xs text-muted-foreground">この期間の使用量はありません。</p>
      ) : (
        <ul className="space-y-2">
          {bars.map((bar) => (
            <li key={bar.name} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-medium">{bar.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {share(bar.total)}
                  {costPerPercent !== null && `（全体の${formatPercent(grand > 0 ? (bar.total / grand) * 100 : 0)}%）`}
                </span>
              </div>
              <div
                className="flex h-3 overflow-hidden rounded-sm bg-muted"
                style={{ width: `${max > 0 ? Math.max(2, (bar.total / max) * 100) : 0}%` }}
              >
                {bar.items.map((item, i) => (
                  <div
                    key={item.sessionKey}
                    title={`${item.title}: ${share(item.costUsd)}（トークン ${formatTokens(totalTokens(item))}）`}
                    className="h-full border-r-2 border-background last:border-r-0"
                    style={{
                      width: `${bar.total > 0 ? (item.costUsd / bar.total) * 100 : 0}%`,
                      background: "var(--primary)",
                      opacity: SHADES[i % SHADES.length],
                    }}
                  />
                ))}
              </div>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {bar.items.slice(0, 3).map((item) => (
                  <li key={item.sessionKey} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{item.title}</span>
                    <span className="shrink-0 tabular-nums">
                      {share(item.costUsd)} / {formatTokens(totalTokens(item))}トークン
                    </span>
                  </li>
                ))}
                {bar.items.length > 3 && <li>ほか{bar.items.length - 3}件</li>}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
