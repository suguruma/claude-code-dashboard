import type { DesktopSessionGroup, DesktopSessionStatus, DesktopSessionSummary } from "./desktopSessionTypes"
import { collectDecisions } from "./housekeeping"

/** decisions: 次にやる判断(⑬。整理ページ・ホームと同じ数え方。要対応・送信上限・エラー・届かない送信) */
export type StatusFilter = "all" | DesktopSessionStatus | "highContext" | "decisions"

export interface DesktopSessionFilters {
  status: StatusFilter
  /** "all" | "none"(グループなし) | グループID */
  group: string
  /** "all" | モデルID */
  model: string
  /** "all" | 作業フォルダ名 */
  folder: string
  includeArchived: boolean
  /** list: 一覧 / group: グループ別。組織図はホーム(/) */
  view: "list" | "group"
}

export const DEFAULT_FILTERS: DesktopSessionFilters = {
  status: "all",
  group: "all",
  model: "all",
  folder: "all",
  includeArchived: false,
  view: "list",
}

/**
 * 保存された絞り込みを、今の形に直す。項目が足りなければ既定値で埋める。
 * 組織図が別ページになる前に保存された `view: "org"` や、未知の値は、一覧に戻す。
 */
export function normalizeFilters(stored: Partial<Omit<DesktopSessionFilters, "view">> & { view?: string }): DesktopSessionFilters {
  return { ...DEFAULT_FILTERS, ...stored, view: stored.view === "group" ? "group" : "list" }
}

export function applyFilters(
  sessions: DesktopSessionSummary[],
  filters: DesktopSessionFilters,
  highContextRatio: number
): DesktopSessionSummary[] {
  const decided = filters.status === "decisions" ? new Set(collectDecisions(sessions).map((d) => d.id)) : null
  return sessions.filter((s) => {
    if (!filters.includeArchived && s.isArchived) return false
    if (decided) {
      if (!decided.has(s.id)) return false
    } else if (filters.status === "highContext") {
      if (!s.context || s.context.ratio < highContextRatio) return false
    } else if (filters.status !== "all" && s.status !== filters.status) {
      return false
    }
    if (filters.group === "none") {
      if (s.group) return false
    } else if (filters.group !== "all" && s.group?.id !== filters.group) {
      return false
    }
    if (filters.model !== "all" && s.model !== filters.model) return false
    if (filters.folder !== "all" && s.folderName !== filters.folder) return false
    return true
  })
}

export interface SessionBucket {
  key: string
  name: string
  sessions: DesktopSessionSummary[]
}

/** グループ別の表示用に分ける。Desktopのサイドバーの並び順に従い、グループなしは最後 */
export function bucketByGroup(sessions: DesktopSessionSummary[], groups: DesktopSessionGroup[]): SessionBucket[] {
  const buckets: SessionBucket[] = []
  for (const g of groups) {
    const members = sessions.filter((s) => s.group?.id === g.id)
    if (members.length > 0) buckets.push({ key: g.id, name: g.name, sessions: members })
  }
  const ungrouped = sessions.filter((s) => !s.group || !groups.some((g) => g.id === s.group?.id))
  if (ungrouped.length > 0) buckets.push({ key: "none", name: "グループなし", sessions: ungrouped })
  return buckets
}

/**
 * 絞り込みの選択肢に出すグループと件数。件数0のグループは隠す。
 * 件数は、アーカイブ済みを含める設定ならそれも数える。選択中のグループは、0件になっても選択肢から消さない。
 */
export function visibleGroups(
  groups: DesktopSessionGroup[],
  sessions: DesktopSessionSummary[],
  includeArchived: boolean,
  selectedGroupId: string
): DesktopSessionGroup[] {
  const counts = new Map<string, number>()
  for (const s of sessions) {
    if (s.group && (includeArchived || !s.isArchived)) counts.set(s.group.id, (counts.get(s.group.id) ?? 0) + 1)
  }
  return groups
    .map((g) => ({ ...g, count: counts.get(g.id) ?? 0 }))
    .filter((g) => g.count > 0 || g.id === selectedGroupId)
}

/** 絞り込みの選択肢(出現するモデル・作業フォルダ)を、件数の多い順に返す */
export function collectOptions(sessions: DesktopSessionSummary[], pick: (s: DesktopSessionSummary) => string | null): string[] {
  const counts = new Map<string, number>()
  for (const s of sessions) {
    const value = pick(s)
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value]) => value)
}
