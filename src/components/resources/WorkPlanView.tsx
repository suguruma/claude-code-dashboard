"use client"

import { useMonitorPlan } from "@/hooks/useMonitor"
import { useTicker } from "@/hooks/useStartupTimes"
import { PLAN_STATE_LABEL, type MonitorPlanResponse, type PlanState } from "@/lib/monitor/monitorTypes"
import { fileStatusText, groupHeadline, orderCell, resetText } from "@/lib/monitor/planView"
import { MonitorLoadError, MonitorSetupNotice, MonitorSkeleton } from "./MonitorNotices"

const SECTION = "space-y-3 rounded-xl p-4 ring-1 ring-foreground/10"
const PHRASE = "[word-break:auto-phrase]"

/** 状態の札の色(文字で状態を書くので、色は補助) */
const STATE_STYLE: Record<PlanState, React.CSSProperties | undefined> = {
  doing: { color: "var(--status-good-text)" },
  waiting: { color: "var(--status-warning-text)" },
  todo: undefined,
  later: undefined,
}

/**
 * ［作業と待ち］(⑭ WC-1・WC-2)。上に利用上限の回復を待っているセッション、下に作業の計画。読み取り専用。
 */
export function WorkPlanView() {
  const { data, error, isLoading, isValidating, reload } = useMonitorPlan(true)

  if (isLoading && !data) return <MonitorSkeleton />
  if (error && !data) return <MonitorLoadError text="見張りの記録を読み込めませんでした" onRetry={() => reload()} busy={isValidating} />
  if (!data) return null
  if (!data.configured) return <MonitorSetupNotice />
  return (
    <div className="space-y-6">
      <WaitingSection data={data} />
      <PlanSection data={data} />
    </div>
  )
}

function WaitingSection({ data }: { data: MonitorPlanResponse }) {
  const tick = useTicker(true, 30_000)
  const now = tick || data.generatedAt
  const { waiting } = data
  const problem = fileStatusText(waiting.status, "利用上限の待ち行列")
  return (
    <section className={SECTION} aria-labelledby="waiting-title" data-testid="monitor-waiting">
      <h2 id="waiting-title" className="font-semibold">
        利用上限の回復を待っているセッション {waiting.items.length}件
      </h2>
      {problem ? (
        <p className="text-sm text-muted-foreground">{problem}</p>
      ) : waiting.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">利用上限の回復を待っているセッションはありません</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-normal">セッション</th>
                <th className="py-1 pr-3 font-normal">グループ</th>
                <th className="py-1 pr-3 font-normal">回復の見込み</th>
                <th className="py-1 font-normal">回復の後の次の一歩</th>
              </tr>
            </thead>
            <tbody>
              {waiting.items.map((w) => (
                <tr key={w.sessionId} className="border-t align-top">
                  <td className={`py-2 pr-3 ${PHRASE}`}>{w.title}</td>
                  <td className={`py-2 pr-3 ${PHRASE}`}>{w.group || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{resetText(w.resetsAt, now)}</td>
                  <td className={`py-2 ${PHRASE}`}>{w.next || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!problem && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer content-center text-muted-foreground">
            再開した {waiting.resumedToday}件・起こした {waiting.sentToday}件（今日）
          </summary>
          <p className="pt-1 text-muted-foreground">再開した・起こしたセッションは、待ち行列の記録の件数だけを出します。</p>
        </details>
      )}
    </section>
  )
}

function PlanSection({ data }: { data: MonitorPlanResponse }) {
  const { plan } = data
  const problem = fileStatusText(plan.status, "作業計画")
  const total = plan.groups.reduce((n, g) => n + g.items.length, 0)
  return (
    <section className={SECTION} aria-labelledby="plan-title" data-testid="monitor-plan">
      <h2 id="plan-title" className="font-semibold">
        作業の計画 {total}件
      </h2>
      {problem ? (
        <p className="text-sm text-muted-foreground">{problem}</p>
      ) : total === 0 ? (
        <p className="text-sm text-muted-foreground">作業計画に、今の作業はありません</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">順・大きさ・再開：順は先にやる順（1 が先）、大きさは大・中・小、再開は易（止まっても再開しやすい）・難</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="monitor-plan-table">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="w-[26%] py-1 pr-3 font-normal">セッション</th>
                  <th className="py-1 pr-3 font-normal">作業</th>
                  <th className="w-[8.5rem] py-1 pr-3 font-normal">状態</th>
                  <th className="w-[7.5rem] py-1 font-normal">順・大きさ・再開</th>
                </tr>
              </thead>
              {plan.groups.map((g) => (
                <tbody key={g.name}>
                  <tr className="border-t bg-muted/40">
                    <th colSpan={4} scope="colgroup" className={`py-1.5 pl-2 text-left font-semibold ${PHRASE}`}>
                      {g.name}
                      <span className="ml-3 font-normal text-muted-foreground">{groupHeadline(g)}</span>
                    </th>
                  </tr>
                  {g.items.map((item) => (
                    <tr key={`${item.sessionId}\t${item.task}`} className="border-t align-top">
                      <td className={`py-2 pr-3 ${PHRASE}`}>{item.title}</td>
                      <td className={`py-2 pr-3 ${PHRASE}`}>{item.task || "—"}</td>
                      <td className="py-2 pr-3">
                        <span className="inline-block whitespace-nowrap rounded-md px-1.5 ring-1 ring-foreground/15" style={STATE_STYLE[item.state]}>
                          {PLAN_STATE_LABEL[item.state]}
                        </span>
                      </td>
                      <td className="py-2 whitespace-nowrap tabular-nums">{orderCell(item.order, item.size, item.resume)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}
      {!problem && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer content-center text-muted-foreground">済み {plan.doneCount}件</summary>
          <p className="pt-1 text-muted-foreground">済んだ作業は件数だけを出します。</p>
        </details>
      )}
      {!problem && (plan.skipped > 0 || data.waiting.skipped > 0) && (
        <p className="text-sm text-muted-foreground">列の足りない行など、読めなかった行：作業計画 {plan.skipped}行・待ち行列 {data.waiting.skipped}行</p>
      )}
    </section>
  )
}
