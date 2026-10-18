import { TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  formatDollars,
  formatJst,
  formatJstTime,
  formatPercent,
  formatRemaining,
  formatTokens,
  usageLevel,
  type UsageLevel,
} from "@/lib/usageFormat"
import type { UsageWindowView } from "@/lib/usageTypes"

const LEVEL_COLOR: Record<UsageLevel, string> = {
  ok: "var(--primary)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
}

const LEVEL_LABEL: Record<UsageLevel, string | null> = {
  ok: null,
  warning: "注意（80%以上）",
  serious: "警戒（90%以上）",
  critical: "危険（95%以上）",
}

const TICKS = [80, 90, 95]

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/** 1つの窓(5時間・週・週のモデル別)のゲージ。公式値は塗りつぶし、推定の増分は斜線で区別する */
export function UsageGauge({ window: w, now }: { window: UsageWindowView; now: number }) {
  const official = w.official?.percentUsed ?? null
  const estimated = w.estimate.kind === "estimate" ? w.estimate : null
  const display = w.displayPercent
  const level = usageLevel(display)
  const color = LEVEL_COLOR[level]
  const solid = official !== null ? clamp(official) : 0
  const stripeEnd = estimated ? clamp(estimated.percent) : solid
  const levelLabel = LEVEL_LABEL[level]

  return (
    <section className="space-y-2 rounded-xl p-4 ring-1 ring-foreground/10" aria-label={`${w.label}の利用上限`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{w.label}</h3>
        {levelLabel && (
          <span className="text-xs font-medium" style={{ color }}>
            {levelLabel}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums" style={level === "ok" ? undefined : { color }}>
          {display === null ? "—" : `${formatPercent(display)}%`}
        </span>
        <span className="text-xs text-muted-foreground">
          {estimated ? `推定（${formatPercent(estimated.low)}〜${formatPercent(estimated.high)}%）` : display === null ? "公式値なし" : "公式値"}
        </span>
      </div>

      <div
        role="img"
        aria-label={display === null ? `${w.label}: 公式値なし` : `${w.label}: ${formatPercent(display)}%`}
        className="relative h-3 overflow-hidden rounded-full bg-muted"
      >
        <div className="absolute inset-y-0 left-0" style={{ width: `${solid}%`, background: color }} />
        {estimated && stripeEnd > solid && (
          <div
            className="absolute inset-y-0"
            style={{
              left: `${solid}%`,
              width: `${stripeEnd - solid}%`,
              background: `repeating-linear-gradient(45deg, ${color} 0 3px, transparent 3px 6px)`,
            }}
          />
        )}
        {TICKS.map((t) => (
          <div key={t} className="absolute inset-y-0 w-px bg-foreground/30" style={{ left: `${t}%` }} />
        ))}
      </div>

      <div className="space-y-0.5 text-xs text-muted-foreground">
        <div>
          {w.official ? (
            <>
              公式値 {w.official.percentUsed}%（{formatJst(w.official.recordedAt)} に記録）
            </>
          ) : w.previousOfficial ? (
            <>
              公式値なし（枠が切り替わりました。前の枠の最後の公式値は {w.previousOfficial.percentUsed}%、
              {formatJst(w.previousOfficial.recordedAt)} 記録）
            </>
          ) : (
            "公式値なし"
          )}
        </div>
        {w.estimate.kind === "none" && w.estimate.reason === "no-calibration" && w.costUsd > 0 && (
          <div>推定できません（較正に使える公式値がありません）</div>
        )}
        <div>
          {w.resetsAt !== null ? (
            <>
              {formatRemaining(w.resetsAt - now)}（{formatJst(w.resetsAt)} にリセット）
            </>
          ) : (
            "次の枠はまだ始まっていません"
          )}
        </div>
        {w.pace && <PaceLine window={w} now={now} />}
        <details className="pt-0.5">
          <summary className="cursor-pointer select-none">内訳（枠内の使用量・係数）</summary>
          <div className="mt-1 space-y-0.5">
            <div>
              枠内の使用量: API価格に換算して約{formatDollars(w.costUsd)}（請求額ではありません。入力 {formatTokens(w.tokens.input)} / 出力 {formatTokens(w.tokens.output)} /
            キャッシュ読み {formatTokens(w.tokens.cacheRead)} / キャッシュ作成 {formatTokens(w.tokens.cacheWrite)}）
          </div>
          {w.calibration && (
            <div>
              1%あたり {formatDollars(w.calibration.costPerPercentLow)}
              {w.calibration.costPerPercentHigh !== null ? `〜${formatDollars(w.calibration.costPerPercentHigh)}` : "以上"}（公式値
              {w.calibration.samples}点から）
            </div>
          )}
          </div>
        </details>
      </div>
    </section>
  )
}

function PaceLine({ window: w, now }: { window: UsageWindowView; now: number }) {
  const pace = w.pace
  if (!pace) return null
  const rate = `${formatPercent(pace.ratePerHour)}%/時`
  const basis = pace.basis === "ewma30" ? "直近の消費の平滑" : "直近24時間の平均"
  const mean60 = pace.mean60PerHour !== null ? `、直近60分の平均 ${formatPercent(pace.mean60PerHour)}%/時` : ""
  if (pace.etaAt === null) {
    return (
      <div>
        ペース: {rate}（{basis}{mean60}）。いま使っていないため、100%には達しません
      </div>
    )
  }
  const eta = pace.etaAt <= now ? "すでに100%に達しています" : `このペースだと ${formatJstTime(pace.etaAt)} 頃（${formatRemaining(pace.etaAt - now)}）に100%`
  // リセットとの差が小さいときは、予測の誤差の範囲なので、赤い警告にせず黄色の「ほぼ同時」にする
  if (pace.nearReset) {
    return (
      <div>
        ペース: {rate}（{basis}{mean60}）。{eta}。
        <span
          className="ml-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-px align-middle text-[11px] font-medium text-foreground"
          style={{
            borderColor: "var(--status-warning)",
            background: "color-mix(in oklab, var(--status-warning) 18%, transparent)",
          }}
        >
          <TriangleAlert className="size-3" style={{ color: "var(--status-warning)" }} aria-hidden />
          リセットとほぼ同時
        </span>
      </div>
    )
  }
  return (
    <div className={cn(pace.beforeReset && "font-medium")} style={pace.beforeReset ? { color: "var(--status-serious)" } : undefined}>
      ペース: {rate}（{basis}{mean60}）。{eta}
      {pace.beforeReset ? "。リセットより先に達する見込みです" : "。リセットまでには達しない見込みです"}
    </div>
  )
}
