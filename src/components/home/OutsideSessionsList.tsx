import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import { selectOutsideSessions } from "@/lib/homeDashboard"
import { SendCountBadge } from "@/components/desktopSessions/Messaging"
import { DesktopStatusBadge } from "@/components/desktopSessions/statusMeta"

interface OutsideSessionsListProps {
  sessions: DesktopSessionSummary[]
  /** 組織図にカードとして出ているセッションのID。組織図のデータがまだ無いときは null */
  shownIds: string[] | null
  /** 組織図のデータを取れなかった(どれが組織図に出ているか分からない) */
  failed?: boolean
  onSelect: (id: string) => void
}

/**
 * ホームの「組織図に出ていないセッション」(⑧)。ほかのグループ・指揮役のいないグループ・グループに入っていないセッションを、
 * 注意の要る順に短く並べ、全部はセッション一覧で見る。行を押すとセッションの詳細が開く。
 */
export function OutsideSessionsList({ sessions, shownIds, failed = false, onSelect }: OutsideSessionsListProps) {
  if (shownIds === null) {
    return (
      <section aria-label="組織図に出ていないセッション" className="space-y-2" data-testid="home-outside">
        <h2 className="text-sm font-medium">組織図に出ていないセッション</h2>
        <p className="text-xs text-muted-foreground">
          {failed ? "組織図のデータを取得できないため、組織図に出ていないセッションを選べません。" : "組織図の読み込みを待っています…"}{" "}
          <Link href="/desktop-sessions" className="text-primary hover:underline">
            セッション一覧ですべて見る
          </Link>
        </p>
      </section>
    )
  }
  const { items, total } = selectOutsideSessions(sessions, new Set(shownIds))

  return (
    <section aria-label="組織図に出ていないセッション" className="space-y-2" data-testid="home-outside">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">
          組織図に出ていないセッション
          <span className="ml-2 text-xs font-normal text-muted-foreground">{total}件</span>
        </h2>
        <Link href="/desktop-sessions" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          セッション一覧ですべて見る <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        ほかのグループ・指揮役のいないグループ・グループに入っていないセッションです（アーカイブ済みとサイドチャットは除く）。対応待ち（許可待ち・承認待ち・判断待ちなど）・実行中を先に並べます。
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">ありません。すべてのセッションが組織図に出ています。</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-muted"
                data-testid="home-outside-row"
                data-session-id={s.id}
              >
                <DesktopStatusBadge status={s.status} reason={s.statusReason} info={s.needsActionInfo} standby={s.standbyInfo} />
                <span className="min-w-0 flex-1 truncate font-medium" title={s.title}>
                  {s.title}
                </span>
                {s.group ? (
                  <Badge variant="secondary" className="shrink-0">
                    {s.group.name}
                  </Badge>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">グループなし</span>
                )}
                <SendCountBadge messaging={s.messaging} />
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  コンテキスト {s.context ? `${Math.round(s.context.ratio * 100)}%` : "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {total > items.length && (
        <p className="text-xs text-muted-foreground">
          ほか {total - items.length}件。
          <Link href="/desktop-sessions" className="text-primary hover:underline">
            セッション一覧ですべて見る
          </Link>
        </p>
      )}
    </section>
  )
}
