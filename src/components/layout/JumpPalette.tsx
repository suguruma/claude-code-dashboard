"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { toast } from "sonner"
import { StatusMarkBadge } from "@/components/desktopSessions/statusMeta"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDesktopSessions } from "@/hooks/useDesktopSessions"
import { writePersisted } from "@/hooks/useLocalStorage"
import { DEFAULT_FILTERS, FILTER_STORAGE_KEY, normalizeFilters, type DesktopSessionFilters } from "@/lib/desktopSessionFilters"
import { detailHref, emptyBuckets, searchJump, type JumpBucket, type JumpItem } from "@/lib/jumpSearch"
import { sessionDeepLink } from "@/lib/sessionMessaging"
import { openInDesktop } from "@/lib/openInDesktop"
import { buildMarks } from "@/lib/statusMark"
import { cn } from "@/lib/utils"
import { NAV_GROUPS } from "./navConfig"

const PAGES = NAV_GROUPS.flatMap((g) => g.items).map((i) => ({ href: i.href, label: i.label }))
/** 開いていない間は取らない。開いている間は一覧と同じ間隔 */
const SWR_WHEN_OPEN = { refreshWhenHidden: false }

/** 字を打っている欄の中か(Ctrl+K を横取りしない。A9) */
function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT"
}

/**
 * 飛び先の検索(⑮ OR-5)。どのページからでも Ctrl+K で開く。上のバーに「探す Ctrl+K」(1100px 未満は虫眼鏡だけ)。
 * Enter で Dashboard の詳細、Shift+Enter で Claude Desktop のそのセッションを開くだけ(D2)、Esc で閉じる。
 * 日本語の変換を確定する Enter では動かない。Ctrl+1〜6 は配る exe だけの近道(ブラウザではタブの切り替えと重なる)。
 */
export function JumpPalette() {
  const [open, setOpenState] = useState(false)
  // 閉じたら、開く前にフォーカスのあった所(「探す」や、Ctrl+K を押したときの部品)へ戻す(A11)
  const returnTo = useRef<HTMLElement | null>(null)
  const setOpen = (next: boolean | ((v: boolean) => boolean)) =>
    setOpenState((prev) => {
      const value = typeof next === "function" ? next(prev) : next
      if (value && !prev) returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      return value
    })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        if (!open && typingInField(e.target)) return
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="探す（Ctrl+K）"
              aria-keyshortcuts="Control+K"
              data-testid="jump-open"
              onClick={() => setOpen(true)}
            />
          }
        >
          <Search className="size-4" aria-hidden />
          <span className="hidden whitespace-nowrap min-[1100px]:inline">探す</span>
          <span className="hidden items-center gap-0.5 text-muted-foreground min-[1100px]:inline-flex" aria-hidden>
            <kbd className="rounded border px-1 font-sans">Ctrl</kbd>+<kbd className="rounded border px-1 font-sans">K</kbd>
          </span>
        </TooltipTrigger>
        <TooltipContent>探す（Ctrl+K）</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          finalFocus={returnTo}
          className="top-[12vh] w-[min(40rem,calc(100vw-2rem))] max-w-none translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-none motion-reduce:animate-none"
        >
          <DialogTitle className="sr-only">探す</DialogTitle>
          {open && <PaletteBody onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const { data } = useDesktopSessions(true, SWR_WHEN_OPEN)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const marks = useMemo(() => (data ? buildMarks(data.sessions, data.generatedAt) : null), [data])
  const buckets: JumpBucket[] = useMemo(() => {
    if (!data) return query.trim() ? searchJump(query, [], [], PAGES, null) : []
    return query.trim() ? searchJump(query, data.sessions, data.groups, PAGES, marks) : emptyBuckets(data.sessions, marks)
  }, [data, marks, query])
  const flat = useMemo(() => buckets.flatMap((b) => b.items), [buckets])
  const current = Math.min(active, Math.max(0, flat.length - 1))

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" })
  }, [current])

  function go(item: JumpItem, desktop: boolean) {
    if (item.kind === "session") {
      if (desktop) {
        const link = sessionDeepLink(item.id)
        if (!link) {
          toast.error("このセッションは Claude Desktop で開けません")
          return
        }
        void openInDesktop(link)
      } else {
        router.push(detailHref(pathname, item.id))
      }
    } else if (item.kind === "group") {
      // セッション一覧をそのグループに絞って開く(絞り込みは一覧と同じ保存先)
      let stored: DesktopSessionFilters = DEFAULT_FILTERS
      try {
        stored = normalizeFilters(JSON.parse(window.localStorage.getItem(FILTER_STORAGE_KEY) ?? "null") ?? DEFAULT_FILTERS)
      } catch {
        // 読めなければ既定から
      }
      writePersisted(FILTER_STORAGE_KEY, { ...stored, group: item.id })
      router.push("/desktop-sessions")
    } else {
      router.push(item.href)
    }
    onClose()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // 日本語の変換を確定する Enter では動かない(keyCode 229 は変換中の古い形)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive(flat.length === 0 ? 0 : (current + 1) % flat.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive(flat.length === 0 ? 0 : (current - 1 + flat.length) % flat.length)
    } else if (e.key === "Enter" && flat[current]) {
      e.preventDefault()
      go(flat[current], e.shiftKey)
    } else if (e.ctrlKey && /^[1-6]$/.test(e.key) && window.electronAPI?.isElectron) {
      // 配る exe だけの近道。ブラウザではタブの切り替えに使われるので、横取りしない
      const item = flat[Number(e.key) - 1]
      if (item) {
        e.preventDefault()
        go(item, false)
      }
    }
  }

  // 束をまたいだ通し番号(上下の矢印と aria-activedescendant に使う)
  const starts = buckets.map((_, k) => buckets.slice(0, k).reduce((n, b) => n + b.items.length, 0))
  return (
    <div className="flex max-h-[70vh] flex-col">
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        placeholder="セッション・グループ・ページの名前で探す（一部でよい）"
        className="border-b bg-transparent px-4 py-3 text-base outline-none placeholder:text-muted-foreground"
        role="combobox"
        aria-expanded="true"
        aria-controls="jump-list"
        aria-activedescendant={flat[current] ? `jump-item-${current}` : undefined}
        aria-autocomplete="list"
        data-testid="jump-input"
      />
      <div ref={listRef} id="jump-list" role="listbox" aria-label="飛び先" className="min-h-0 flex-1 overflow-y-auto" data-testid="jump-list">
        {!data && !query.trim() && <p className="px-4 py-3 text-muted-foreground">読み込んでいます</p>}
        {data && flat.length === 0 && (
          <p className="px-4 py-3 text-muted-foreground" data-testid="jump-empty">
            {query.trim() ? `「${query.trim()}」に合うセッション・グループ・ページはありません。` : "出せるセッションはありません。"}
          </p>
        )}
        {buckets.map((b, k) => (
          <div key={b.label} role="group" aria-label={b.label}>
            <div className="bg-muted/60 px-4 py-1.5 font-semibold text-muted-foreground">{b.label}</div>
            {b.items.map((item, j) => {
              const i = starts[k] + j
              return (
                <div
                  key={`${item.kind}:${item.id}`}
                  id={`jump-item-${i}`}
                  role="option"
                  aria-selected={i === current}
                  data-index={i}
                  className={cn("flex cursor-pointer items-center gap-2 border-b px-4 py-2 last:border-b-0", i === current && "bg-primary/10")}
                  onMouseMove={() => setActive(i)}
                  onClick={(e) => go(item, e.shiftKey)}
                >
                  {item.kind === "session" && item.mark && <StatusMarkBadge mark={item.mark} />}
                  <span className="min-w-0 truncate">{item.title}</span>
                  {item.sub && <span className="shrink-0 text-muted-foreground">{item.sub}</span>}
                  {item.kind === "page" && <span className="ml-auto shrink-0 text-muted-foreground">ページ</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <p className="border-t px-4 py-2 text-muted-foreground">
        <kbd className="rounded border px-1 font-sans">Enter</kbd> 詳細を開く
        <kbd className="rounded border px-1 font-sans">Shift</kbd>+<kbd className="rounded border px-1 font-sans">Enter</kbd> Claude Desktop で開くだけ
        <kbd className="rounded border px-1 font-sans">Esc</kbd> 閉じる
      </p>
    </div>
  )
}
