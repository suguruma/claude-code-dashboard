"use client"

import { useState } from "react"
import { gb, hhmm, pct, sortSessions, sparkLabel, splitTop, TOP_N, type Metric } from "@/lib/monitor/loadView"
import type { MonitorSnapshotResponse, SnapshotSession } from "@/lib/monitor/monitorTypes"

const PHRASE = "[word-break:auto-phrase]"

/**
 * 「14:33 に動いていたもの」(⑭ WC-4)。上位8件と「ほか n セッション」・［すべて見る（n件）］。
 * 並びは図の［CPU］［メモリ］に合わせ、列の見出し(CPU・メモリ)を押しても並べ替えられる(並べている列に ▼。P2)。
 * 1024 より狭いときは、グループとプロセスの列を出さず、表の下に1行でそう書く(L10)。
 */
export function SnapshotTable({ snap, metric }: { snap: MonitorSnapshotResponse; metric: Metric }) {
  const [sortBy, setSortBy] = useState<Metric | null>(null)
  const [all, setAll] = useState(false)
  const order = sortBy ?? metric
  const { top, rest } = splitTop(snap.sessions, order)
  const rows = all ? sortSessions(snap.sessions, order) : top
  const at = snap.t === null ? "" : hhmm(snap.t)

  const head = (key: Metric, label: string) => (
    <th className="py-1 pr-3 text-right font-normal" aria-sort={order === key ? "descending" : "none"}>
      <button type="button" className="inline-flex min-h-11 items-center gap-1 hover:underline" onClick={() => setSortBy(key)}>
        {label}
        {order === key && <span aria-hidden>▼</span>}
      </button>
    </th>
  )

  return (
    <section className="space-y-3 rounded-xl p-4 ring-1 ring-foreground/10" aria-labelledby="snapshot-title" data-testid="load-snapshot">
      <h2 id="snapshot-title" className="font-semibold">
        {at} に動いていたもの
      </h2>
      {snap.sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">この時刻の記録に、セッションの行がありません</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="load-snapshot-table">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-normal">セッション</th>
                <th className="hidden py-1 pr-3 font-normal min-[1024px]:table-cell">グループ</th>
                {head("cpu", "CPU")}
                {head("mem", "メモリ")}
                <th className="hidden py-1 pr-3 text-right font-normal min-[1024px]:table-cell">プロセス</th>
                <th className="py-1 font-normal">直近30分</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <Row key={s.id} s={s} metric={order} />
              ))}
              {!all && rest.count > 0 && (
                <tr className="border-t text-muted-foreground">
                  <td className="py-2 pr-3">ほか {rest.count} セッション</td>
                  <td className="hidden min-[1024px]:table-cell" />
                  <td className="py-2 pr-3 text-right tabular-nums">{pct(rest.cpu)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{gb(rest.memMb)}</td>
                  <td className="hidden min-[1024px]:table-cell" />
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {snap.sessions.length > TOP_N && (
        <button type="button" className="inline-flex min-h-11 items-center text-sm text-primary hover:underline" onClick={() => setAll((v) => !v)}>
          {all ? `上位${TOP_N}件だけにする` : `すべて見る（${snap.sessions.length}件）`}
        </button>
      )}
      <p className="text-sm text-muted-foreground min-[1024px]:hidden">画面が狭いので、グループとプロセスの数の列を省いています。</p>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold">セッションの外のプログラム</h3>
        {snap.others.length === 0 ? (
          <p className="text-sm text-muted-foreground">セッションの外で 1% 以上使っているものはありません</p>
        ) : (
          <ul className="space-y-0.5 text-sm" data-testid="load-others">
            {snap.others.map((o) => (
              <li key={o.name} className="flex flex-wrap gap-x-3">
                <span className="font-medium">{o.name}</span>
                <span className="tabular-nums">CPU {pct(o.cpu)}</span>
                <span className="tabular-nums text-muted-foreground">メモリ {o.memMb === null ? "—" : gb(o.memMb)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted-foreground">
          Claude Desktop の本体（窓・描画）などはどのセッションにも入らず、ここに出ます（CPU 1% 以上の上位3つ）。
        </p>
      </div>
    </section>
  )
}

function Row({ s, metric }: { s: SnapshotSession; metric: Metric }) {
  const values = metric === "cpu" ? s.sparkCpu : s.sparkMem.map((v) => (v === null ? null : v / 1024))
  return (
    <tr className="border-t align-middle">
      <td className={`py-2 pr-3 ${PHRASE}`}>{s.title}</td>
      <td className={`hidden py-2 pr-3 ${PHRASE} min-[1024px]:table-cell`}>{s.group ?? "—"}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{pct(s.cpu)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{s.memMb === null ? "—" : gb(s.memMb)}</td>
      <td className="hidden py-2 pr-3 text-right tabular-nums min-[1024px]:table-cell">{s.procs ?? "—"}</td>
      <td className="py-2">
        <Spark values={values} label={sparkLabel(values, metric)} />
      </td>
    </tr>
  )
}

function Spark({ values, label }: { values: Array<number | null>; label: string }) {
  const nums = values.filter((v): v is number => v !== null)
  const max = Math.max(1e-6, ...nums)
  const w = 96
  const h = 24
  let d = ""
  values.forEach((v, i) => {
    if (v === null) return
    const px = (i / (values.length - 1)) * w
    const py = h - 2 - (v / max) * (h - 4)
    d += `${d && values[i - 1] !== null ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`
  })
  return (
    <svg width={w} height={h} role="img" aria-label={label} className="block">
      <title>{label}</title>
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth="1.5" />
    </svg>
  )
}
