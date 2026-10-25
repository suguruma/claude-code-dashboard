"use client"

import { useState } from "react"
import { usePersistedState } from "@/hooks/useLocalStorage"
import { useMonitorLoad, useMonitorSnapshot } from "@/hooks/useMonitor"
import { beforeGap, gapSummary, hhmm, initialTime, memText, pct, type Metric } from "@/lib/monitor/loadView"
import type { MonitorLoadResponse } from "@/lib/monitor/monitorTypes"
import { LoadChart } from "./LoadChart"
import { MonitorLoadError, MonitorSetupNotice, MonitorSkeleton } from "./MonitorNotices"
import { SnapshotTable } from "./SnapshotTable"

const RANGES = [1, 2, 6, 24] as const
const SECTION = "space-y-3 rounded-xl p-4 ring-1 ring-foreground/10"
const PILL = "min-h-11 rounded-md px-3 text-sm ring-1 ring-foreground/15"
const PILL_ON = "bg-foreground text-background ring-foreground"

/**
 * ［負荷］(⑭ WC-3〜WC-6・WC-11〜WC-14)。上から：［CPU］［メモリ］と今の値 → 日付と範囲 → 手がかりの1行と［警告のピークを見る］［途切れの直前を見る］
 * → 推移の図 → つながりの図(段3) → 「〇〇 に動いていたもの」 → 出どころの1行。
 * focus：ページの上の警告の帯の［ピークを見る］から渡される時刻(押すたびに nonce が変わる)。
 */
export function LoadView({ focus }: { focus: { at: number; nonce: number } | null }) {
  const [metric, setMetric] = usePersistedState<Metric>("ccd:resources-metric", "cpu")
  const [date, setDate] = useState<string | null>(null)
  const [range, setRange] = useState<number | null>(null)
  // 押して選んだ時刻。選んだときの focus の nonce を持ち、新しい［ピークを見る］が来たらそちらを使う
  const [picked, setPicked] = useState<{ at: number; focusNonce: number } | null>(null)
  const [center, setCenter] = useState<number | null>(null)
  const { data, error, isLoading, isValidating, reload } = useMonitorLoad({ date, range, center }, true, date === null)


  if (isLoading && !data) return <MonitorSkeleton rows={6} />
  if (error && !data) return <MonitorLoadError text="見張りの記録を読み込めませんでした" onRetry={() => reload()} busy={isValidating} />
  if (!data) return null
  if (!data.configured) return <MonitorSetupNotice />

  // 選んだ時刻：押した・ピークを見るで選んだもの(今の窓の中にあるとき)、無ければ警告のピーク、無ければ最後の記録
  const focusNonce = focus?.nonce ?? 0
  const wanted = picked && picked.focusNonce === focusNonce ? picked.at : (focus?.at ?? null)
  const inWindow = wanted !== null && wanted >= data.from && wanted <= data.to ? wanted : null
  const selected = inWindow ?? initialTime(data.points, data.alerts, metric)
  const select = (t: number) => {
    setPicked({ at: t, focusNonce })
    if (!data.isToday && data.rangeHours < 24) setCenter(t)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Header data={data} metric={metric} onMetric={setMetric} />
        <Controls
        data={data}
        onDate={(d) => {
          setDate(d)
          setRange(null)
          setCenter(null)
          setPicked(null)
        }}
        onRange={(r) => {
          setRange(r)
          if (!data.isToday && r < 24) setCenter(selected)
          }}
        />
      </div>
      <ChartSection data={data} metric={metric} selected={selected} onSelect={select} />
      <SnapshotSection at={selected} metric={metric} onSelect={select} />
      <p className="text-sm text-muted-foreground">出どころ：設定した記録のフォルダ（config/monitor.json の cpuDir）。読むだけで、記録の仕組みは動かしません。</p>
    </div>
  )
}

function Header({ data, metric, onMetric }: { data: MonitorLoadResponse; metric: Metric; onMetric: (m: Metric) => void }) {
  const latest = data.points[data.points.length - 1] ?? null
  const cpu = latest ? `CPU ${pct(latest.cpu)}` : "CPU —"
  const mem = latest ? `メモリ ${memText(latest.memMb, data.memTotalMb)}` : "メモリ —"
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="radiogroup" aria-label="図に出す値" className="inline-flex gap-1">
        {(["cpu", "mem"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={metric === m} className={`${PILL} ${metric === m ? PILL_ON : ""}`} onClick={() => onMetric(m)}>
            {m === "cpu" ? "CPU" : "メモリ"}
          </button>
        ))}
      </div>
      <p className="text-sm" data-testid="load-now">
        <span className="font-semibold">{metric === "cpu" ? cpu : mem}</span>
        <span className="ml-3 text-muted-foreground">
          {metric === "cpu" ? mem : cpu}
          {latest?.procs != null && `・プロセス ${latest.procs}`}
          {latest && `（${data.isToday ? "最新" : "その日の最後"} ${hhmm(latest.t)}）`}
        </span>
      </p>
    </div>
  )
}

function Controls({ data, onDate, onRange }: { data: MonitorLoadResponse; onDate: (d: string | null) => void; onRange: (r: number) => void }) {
  const today = data.isToday ? data.date : null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <label className="inline-flex items-center gap-2">
        日付
        <select
          className="min-h-11 rounded-md bg-background px-2 ring-1 ring-foreground/15"
          value={data.date}
          onChange={(e) => onDate(e.target.value === today ? null : e.target.value)}
        >
          {(data.days.includes(data.date) ? data.days : [data.date, ...data.days]).map((d) => (
            <option key={d} value={d}>
              {d.slice(5).replace("-", "/")}
              {d === data.date && data.isToday ? "（今日）" : ""}
            </option>
          ))}
        </select>
      </label>
      <div role="radiogroup" aria-label="範囲" className="inline-flex gap-1">
        {RANGES.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={data.rangeHours === r} className={`${PILL} ${data.rangeHours === r ? PILL_ON : ""}`} onClick={() => onRange(r)}>
            {r}時間
          </button>
        ))}
      </div>
    </div>
  )
}

function ChartSection({ data, metric, selected, onSelect }: { data: MonitorLoadResponse; metric: Metric; selected: number | null; onSelect: (t: number) => void }) {
  const bands = data.alerts[metric]
  const peak = bands.length ? bands[bands.length - 1].peakAt : null
  const gapAt = beforeGap(data.gaps)
  const gapText = gapSummary(data.gaps)
  const empty = emptyText(data)
  return (
    <section className={SECTION} aria-label="推移の図" data-testid="load-chart-section">
      <div className="flex flex-wrap items-center gap-x-3 text-sm">
        <p className="text-muted-foreground">図を押すか ←→ で時刻を選べます（なぞる・Shift+←→ で10分）</p>
        {peak !== null && (
          <button type="button" className="inline-flex min-h-9 items-center text-primary hover:underline" onClick={() => onSelect(peak)}>
            警告のピークを見る
          </button>
        )}
        {gapAt !== null && (
          <button type="button" className="inline-flex min-h-9 items-center text-primary hover:underline" onClick={() => onSelect(gapAt)}>
            途切れの直前を見る
          </button>
        )}
      </div>
      {empty ? (
        <p className="text-sm text-muted-foreground" data-testid="load-empty">
          {empty}
        </p>
      ) : (
        <LoadChart data={data} metric={metric} selected={selected} onSelect={onSelect} />
      )}
      <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
        {gapText && <span data-testid="load-gap-summary">{gapText}</span>}
        {!data.dayHasAlert && <span>この日は警告の行がありません</span>}
        {!data.isToday && data.dayHasAlert && <span data-testid="load-past-alerts">{pastAlertText(data)}</span>}
        {metric === "mem" && data.memTotalSource === null && <span>記録の PC のメモリの総量が分からないので、割合を出さず GB だけ出します</span>}
        {data.skipped > 0 && <span>読めなかった行 {data.skipped}行</span>}
      </div>
    </section>
  )
}

/** 過去の日の警告の回数と最大(灰色の1行。L2) */
function pastAlertText(data: MonitorLoadResponse): string {
  const parts = (["cpu", "mem"] as const)
    .filter((k) => data.alerts[k].length > 0)
    .map((k) => {
      const max = Math.max(...data.alerts[k].map((b) => b.max ?? 0))
      return `${k === "cpu" ? "CPU" : "メモリ"} ${data.alerts[k].length}回（最大 ${pct(max)}）`
    })
  return parts.length ? `この日の警告：${parts.join("・")}` : "この日は警告の行があります（今の範囲の外）"
}

/** 空の状態の文(4-3。WC-14) */
function emptyText(data: MonitorLoadResponse): string | null {
  if (data.status === "unset") return "CPU の記録のフォルダが設定されていません（config/monitor.json の cpuDir）。"
  if (data.status === "refused") return "CPU の記録のフォルダは、認証情報などを含むおそれがあるため読みません。"
  if (data.status === "missing" && data.isToday) {
    const last = data.lastRecordAt === null ? "" : `（最後の記録：${new Date(data.lastRecordAt).getMonth() + 1}/${new Date(data.lastRecordAt).getDate()} ${hhmm(data.lastRecordAt)}）`
    return `今日の記録はまだありません${last}。PC を起動し直した後は、記録の仕組みが動くまで空きます。日付を選ぶと前の日を見られます`
  }
  if (data.status === "missing") {
    const first = data.days[data.days.length - 1]
    return `${data.date.slice(5).replace("-", "/")} の記録はありません。${first ? `記録があるのは ${first.slice(5).replace("-", "/")} からです` : ""}`
  }
  if (data.status === "unreadable") return "CPU の記録のファイルを読めませんでした。"
  if (data.points.length === 0) return "この時間帯には記録がありません（PC が止まっていたか、記録の仕組みが動いていませんでした）"
  return null
}

function SnapshotSection({ at, metric, onSelect }: { at: number | null; metric: Metric; onSelect: (t: number) => void }) {
  const { data, error } = useMonitorSnapshot(at)
  if (at === null) return null
  if (error && !data) return <p className="text-sm" style={{ color: "var(--status-critical-text)" }}>選んだ時刻の記録を読み込めませんでした</p>
  if (!data) return <MonitorSkeleton rows={8} />
  if (data.t === null)
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground" data-testid="load-no-record">
        <span>
          {hhmm(at)} の前後1分に記録がありません。{data.nearest !== null && `いちばん近い記録は ${hhmm(data.nearest)} です`}
        </span>
        {data.nearest !== null && (
          <button type="button" className="inline-flex min-h-11 items-center text-primary hover:underline" onClick={() => onSelect(data.nearest!)}>
            {hhmm(data.nearest)} を選ぶ
          </button>
        )}
      </div>
    )
  return <SnapshotTable snap={data} metric={metric} />
}
