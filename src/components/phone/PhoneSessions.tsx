"use client"

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { useSearchParams } from "next/navigation"
import { Check, ChevronRight, SlidersHorizontal, Send, X } from "lucide-react"
import { useDesktopSessions } from "@/hooks/useDesktopSessions"
import type { DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import {
  PHONE_STATUS_OPTIONS,
  PHONE_SWR_OPTIONS,
  activeFilterCount,
  applyPhoneFilters,
  parsePhoneFilters,
  phoneFiltersToSearch,
  sortPhoneSessions,
  summarizeGroups,
  type PhoneFilters,
} from "@/lib/phoneView"
import { cn } from "@/lib/utils"
import { formatAgo } from "@/components/desktopSessions/format"
import { CARD, META, PhoneContextMeter, PhoneNotice, PhoneStatusBadge, TAPPABLE } from "./parts"
import { openSession, subscribeLocation } from "./sessionHash"

/**
 * スマホのセッション一覧(⑪-2)。1件を1枚のカード(名前・グループ・状態・最後の動き・コンテキストの%)にし、
 * 並びは 対応待ち → 実行中 → そのほか(Q21)。絞り込みはボタン1つにまとめ、下から出るシートで選ぶ。
 * 絞り込みは URL の検索(`?status=&group=`)で持つ(ホームのグループの一覧から、そのグループで絞って開けるように)。
 * 絞り込みのシートは、詳細のシートと同じく履歴を1つ積み(`#filter`)、ブラウザの戻る(iPhone の左端からのスワイプ)で閉じる。
 * 閉じても、選んだ絞り込みは残す。
 */

const FILTER_HASH = "#filter"

/** 絞り込みのシートを、このページで開いて履歴を積んだか(直接 `#filter` の URL を開いたときは、戻らずに消す) */
let filterPushed = false
export function PhoneSessions() {
  const { data, error, isLoading } = useDesktopSessions(true, PHONE_SWR_OPTIONS)
  const searchParams = useSearchParams()
  const filters = useMemo(() => parsePhoneFilters(searchParams), [searchParams])
  const sheetOpen = useSyncExternalStore(
    subscribeLocation,
    () => window.location.hash === FILTER_HASH,
    () => false
  )
  // シートで選んだ絞り込み。ブラウザの戻るで閉じると、開く前の URL(前の絞り込み)に戻るので、閉じた後に書き戻す
  const chosenRef = useRef<PhoneFilters | null>(null)

  useEffect(() => {
    if (sheetOpen || !chosenRef.current) return
    const search = phoneFiltersToSearch(chosenRef.current)
    chosenRef.current = null
    if (window.location.search !== search) window.history.replaceState(null, "", window.location.pathname + search)
  }, [sheetOpen])

  const available = data !== null && data.source !== "none"
  const highContextRatio = data?.highContextRatio ?? 0.8
  const sorted = useMemo(() => (available ? sortPhoneSessions(data.sessions) : []), [available, data])
  const shown = useMemo(() => applyPhoneFilters(sorted, filters, highContextRatio), [sorted, filters, highContextRatio])
  const groups = useMemo(() => (available ? summarizeGroups(data.sessions, data.groups) : []), [available, data])
  const count = activeFilterCount(filters)

  function setFilters(next: PhoneFilters) {
    // 画面の再読み込みをせずに、URL の検索だけを書き換える(Next の useSearchParams は追従する)。
    // state は null で渡す(Next の内部の state を渡すと、Next は自分の呼び出しとみなして追従しない)。シートの `#filter` は残す
    chosenRef.current = next
    window.history.replaceState(null, "", window.location.pathname + phoneFiltersToSearch(next) + window.location.hash)
  }

  function openSheet() {
    chosenRef.current = filters
    filterPushed = true
    window.location.hash = FILTER_HASH
  }

  function closeSheet() {
    if (filterPushed) {
      filterPushed = false
      window.history.back()
      return
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search)
    window.dispatchEvent(new HashChangeEvent("hashchange"))
  }

  return (
    <div className="space-y-3">
      <PhoneNotice
        error={error}
        isLoading={isLoading}
        hasData={data !== null}
        empty={data?.source === "none" ? "Claude Desktop のデータが見つかりません。PC の画面で、データの場所を確かめてください。" : null}
      />

      {available && (
        <>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-base" data-testid="phone-sessions-count">
              {shown.length}件
              <span className={cn(META, "ml-1")}>（全{sorted.length}件。アーカイブ済みは除く）</span>
            </p>
            <button
              type="button"
              onClick={openSheet}
              aria-haspopup="dialog"
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-base active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                count > 0 && "border-primary font-medium"
              )}
              data-testid="phone-filter-button"
            >
              <SlidersHorizontal className="size-5" aria-hidden />
              絞り込み{count > 0 && `（${count}）`}
            </button>
          </div>

          {shown.length === 0 ? (
            <p className={cn(CARD, "p-4 text-base")}>条件に合うセッションがありません。</p>
          ) : (
            <ul className="space-y-2" data-testid="phone-session-cards">
              {shown.map((s) => (
                <li key={s.id}>
                  <SessionCard session={s} />
                </li>
              ))}
            </ul>
          )}

          {sheetOpen && (
            <FilterSheet
              filters={filters}
              groups={groups}
              onChange={setFilters}
              onClose={closeSheet}
            />
          )}
        </>
      )}
    </div>
  )
}

function SessionCard({ session: s }: { session: DesktopSessionSummary }) {
  return (
    <button
      type="button"
      onClick={() => openSession(s.id)}
      className={cn(CARD, TAPPABLE, "flex items-center gap-2 p-3", s.messaging?.stopped && "border-[var(--status-critical)]")}
      data-testid="phone-session-card"
    >
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="line-clamp-2 block text-base font-medium [overflow-wrap:anywhere]" data-field="name">
          {s.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span data-field="status">
            <PhoneStatusBadge status={s.status} info={s.needsActionInfo} standby={s.standbyInfo} />
          </span>
          {s.messaging?.stopped && (
            <span className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-[var(--status-critical-text)]">
              <Send className="size-4" aria-hidden />
              送信上限で停止
            </span>
          )}
        </span>
        <span className={cn(META, "block truncate")}>
          <span data-field="group">{s.group?.name ?? "グループなし"}</span>・<span data-field="activity">{formatAgo(s.lastActivityAt)}</span>
        </span>
        <span className="block" data-field="context">
          <PhoneContextMeter context={s.context} />
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(TAPPABLE, "flex items-center gap-2 rounded-lg px-3 py-2.5 text-base", selected && "bg-muted font-medium")}
    >
      <Check className={cn("size-5 shrink-0", selected ? "opacity-100" : "opacity-0")} aria-hidden />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</span>
    </button>
  )
}

function FilterSheet({
  filters,
  groups,
  onChange,
  onClose,
}: {
  filters: PhoneFilters
  groups: ReturnType<typeof summarizeGroups>
  onChange: (next: PhoneFilters) => void
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  // 15秒ごとの読み直しで描き直しても、フォーカスとスクロールの止めを付け直さない(開いたときに1回だけ)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener("keydown", onKey)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" data-testid="phone-filter-sheet">
      <button type="button" aria-label="絞り込みを閉じる" className="absolute inset-0 bg-black/40" onClick={onClose} tabIndex={-1} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-filter-title"
        className="relative mx-auto flex max-h-[85dvh] w-full max-w-xl flex-col rounded-t-2xl bg-background shadow-lg"
      >
        <div className="flex min-h-14 items-center gap-2 border-b pr-2 pl-4">
          <h2 id="phone-filter-title" className="flex-1 text-base font-semibold">
            絞り込み
          </h2>
          {activeFilterCount(filters) > 0 && (
            <button
              type="button"
              onClick={() => onChange({ status: "all", group: "all" })}
              className="min-h-11 rounded-lg px-3 text-base text-primary active:bg-muted"
            >
              元に戻す
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="inline-flex size-11 items-center justify-center rounded-lg active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto overscroll-contain px-2 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <fieldset>
            <legend className={cn(META, "px-3 pb-1")}>状態</legend>
            <div role="radiogroup" aria-label="状態" className="space-y-0.5">
              {PHONE_STATUS_OPTIONS.map((o) => (
                <Choice key={o.value} selected={filters.status === o.value} onClick={() => onChange({ ...filters, status: o.value })}>
                  {o.label}
                </Choice>
              ))}
            </div>
          </fieldset>
          {groups.length > 0 && (
            <fieldset>
              <legend className={cn(META, "px-3 pb-1")}>グループ</legend>
              <div role="radiogroup" aria-label="グループ" className="space-y-0.5">
                <Choice selected={filters.group === "all"} onClick={() => onChange({ ...filters, group: "all" })}>
                  すべてのグループ
                </Choice>
                {groups.map((g) => (
                  <Choice key={g.id} selected={filters.group === g.id} onClick={() => onChange({ ...filters, group: g.id })}>
                    {g.name}
                    <span className={cn(META, "ml-1")}>（{g.total}）</span>
                  </Choice>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </div>
    </div>
  )
}
