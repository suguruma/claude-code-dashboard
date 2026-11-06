"use client"

import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Bell, MoreHorizontal } from "lucide-react"
import { StatusMarkBadge } from "@/components/desktopSessions/statusMeta"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { useInbox } from "@/hooks/useInbox"
import { writePersisted } from "@/hooks/useLocalStorage"
import { DEFAULT_FILTERS, FILTER_STORAGE_KEY, normalizeFilters, type DesktopSessionFilters } from "@/lib/desktopSessionFilters"
import { agoText, countText, INBOX_SHOWN, type InboxItem } from "@/lib/inbox"
import { cn } from "@/lib/utils"

/**
 * 知らせの鐘(⑮ OR-4)。上のバーに未読の数を出し、押すと直近の知らせを新しい順に20件まで出す。
 * 行を押すと、その先(セッションは看板の該当カード・PC の警告はリソース［負荷］・利用上限はリソース［利用上限］)へ移り、既読にする。
 * 未読は太字と「● 未読」の文字(色だけに頼らない)。［すべて既読にする］と、行の「…」に「未読に戻す」。
 */
export function InboxBell() {
  const router = useRouter()
  const pathname = usePathname()
  const inbox = useInbox()
  const [open, setOpen] = useState(false)
  const shown = inbox.items.slice(0, INBOX_SHOWN)

  function go(item: InboxItem) {
    void inbox.mark([item])
    setOpen(false)
    if (item.href.startsWith("/desktop-sessions#")) {
      // セッションは看板の該当カードへ(看板にし、グループの絞り込みを外してから移る)
      let stored: DesktopSessionFilters = DEFAULT_FILTERS
      try {
        stored = normalizeFilters(JSON.parse(window.localStorage.getItem(FILTER_STORAGE_KEY) ?? "null") ?? DEFAULT_FILTERS)
      } catch {
        // 読めなければ既定から
      }
      writePersisted(FILTER_STORAGE_KEY, { ...stored, view: "board", group: "all" })
      if (pathname === "/desktop-sessions") {
        // 同じページの中では、ハッシュを替えて看板に知らせる(看板は hashchange を見ている)
        window.location.replace(item.href)
        return
      }
    }
    router.push(item.href)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // 開いたら「見た」(基準の時刻を今に。画面は見る前の値のまま)
        if (next) void inbox.see()
      }}
    >
      <PopoverTrigger
        className="relative inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={inbox.unread > 0 ? `知らせ 未読 ${inbox.unread}件` : "知らせ（未読なし）"}
        data-testid="inbox-bell"
      >
        <Bell className="size-4" aria-hidden />
        {inbox.unread > 0 && (
          <span className="rounded-full bg-[var(--status-critical-text)] px-1.5 text-sm leading-5 font-bold text-background tabular-nums" data-testid="inbox-count" aria-hidden>
            {countText(inbox.unread)}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex items-baseline justify-between gap-3 border-b px-4 py-2.5">
          <PopoverTitle>知らせ（未読 {inbox.unread}）</PopoverTitle>
          {inbox.unread > 0 && (
            <button type="button" className="text-primary hover:underline" onClick={() => void inbox.markAll()} data-testid="inbox-read-all">
              すべて既読にする
            </button>
          )}
        </div>
        {!inbox.ready ? (
          <p className="px-4 py-3 text-muted-foreground">{inbox.error ? "読み込めませんでした" : "読み込んでいます"}</p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-3 text-muted-foreground" data-testid="inbox-empty">
            新しい知らせはありません。
          </p>
        ) : (
          <ul data-testid="inbox-list">
            {shown.map((item) => {
              const unread = inbox.isUnread(item)
              return (
                <li key={item.key} className="flex items-start gap-1 border-b last:border-b-0" data-unread={unread ? "true" : "false"}>
                  <button type="button" className="min-w-0 flex-1 px-4 py-2 text-left hover:bg-muted" onClick={() => go(item)}>
                    <span className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1", unread && "font-semibold")}>
                      {unread && <span className="text-[var(--status-info-text)]">● 未読</span>}
                      {item.mark && <StatusMarkBadge mark={item.mark} />}
                      <span className="min-w-0 break-all">{item.title}</span>
                    </span>
                    <span className="mt-0.5 block text-muted-foreground">
                      {item.what}・{agoText(inbox.now - item.at)}
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="mt-1.5 mr-2 inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-muted"
                      aria-label={`${item.title} の操作`}
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-36">
                      {unread ? (
                        <DropdownMenuItem onClick={() => void inbox.mark([item])}>既読にする</DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => void inbox.mark([item], true)}>未読に戻す</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
