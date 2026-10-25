/**
 * ページを開いた回数(⑬ FS-7・報告71 の案 A)。画面とサーバーで同じ規則を使うので、サーバー専用モジュールを import しない。
 * 数えるのは、サイドバーの13ページ(固定の表)のパスと、日付ごとの回数だけ。クエリ・セッションの名前・時刻の細かい値は持たない。
 * 画面からは、1日に1パスにつき1回だけ送る(同じ日に何度開いても1回)。外部へは送らない。
 */

/** 数えるページ。サイドバーの項目と使い方ガイドの13ページ(navConfig と同じであることを試験で確かめる) */
export const PAGE_VISIT_PATHS = [
  "/",
  "/desktop-sessions",
  "/desktop-sessions/usage",
  "/desktop-sessions/housekeeping",
  "/org-rules",
  "/rules",
  "/skills",
  "/settings",
  "/trace",
  "/refactor",
  "/migrate",
  "/lan-access",
  "/help",
] as const

export type PageVisitPath = (typeof PAGE_VISIT_PATHS)[number]

/** 表に出す日数(直近30日)。ファイルにもこれより古い日は残さない */
export const PAGE_VISIT_KEEP_DAYS = 30

/** 画面からまとめて送る間隔、サーバーがファイルへ書く間隔(どちらも1分に1回まで) */
export const PAGE_VISIT_WRITE_INTERVAL_MS = 60_000

/** 1パス・1日あたりの回数 */
export type PageVisitCounts = Record<string, Record<string, number>>

export interface PageVisitsData {
  enabled: boolean
  visits: PageVisitCounts
}

export interface PageVisitItem {
  path: string
  date: string
}

export function isPageVisitPath(path: unknown): path is PageVisitPath {
  return typeof path === "string" && (PAGE_VISIT_PATHS as readonly string[]).includes(path)
}

/** その場所の日付(YYYY-MM-DD) */
export function localDateKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 今日から days 日前の日付(YYYY-MM-DD) */
export function daysAgoKey(nowMs: number, days: number): string {
  const d = new Date(nowMs)
  d.setDate(d.getDate() - days)
  return localDateKey(d.getTime())
}

/** 直近 keepDays 日(今日を含む)より古い日を落とし、知らないパス・0回の日も落とす */
export function prunePageVisits(visits: PageVisitCounts, nowMs: number, keepDays = PAGE_VISIT_KEEP_DAYS): PageVisitCounts {
  const oldest = daysAgoKey(nowMs, keepDays - 1)
  const out: PageVisitCounts = {}
  for (const [path, days] of Object.entries(visits ?? {})) {
    if (!isPageVisitPath(path) || !days || typeof days !== "object") continue
    const kept: Record<string, number> = {}
    for (const [date, count] of Object.entries(days)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= oldest && Number.isInteger(count) && count > 0) kept[date] = count
    }
    if (Object.keys(kept).length > 0) out[path] = kept
  }
  return out
}

export interface PageVisitRow {
  path: PageVisitPath
  /** 直近7日・30日の回数(同じ日は1画面につき1回) */
  last7: number
  last30: number
  /** 最後に開いた日。無ければ null */
  lastDate: string | null
}

/** 設定のページの表。13ページを、30日の回数の多い順に並べる(同じなら表の順) */
export function summarizePageVisits(visits: PageVisitCounts, nowMs: number): PageVisitRow[] {
  const from7 = daysAgoKey(nowMs, 6)
  const from30 = daysAgoKey(nowMs, PAGE_VISIT_KEEP_DAYS - 1)
  const rows = PAGE_VISIT_PATHS.map((path) => {
    let last7 = 0
    let last30 = 0
    let lastDate: string | null = null
    for (const [date, count] of Object.entries(visits[path] ?? {})) {
      if (date < from30) continue
      last30 += count
      if (date >= from7) last7 += count
      if (lastDate === null || date > lastDate) lastDate = date
    }
    return { path, last7, last30, lastDate }
  })
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.last30 - a.row.last30 || a.index - b.index)
    .map(({ row }) => row)
}
