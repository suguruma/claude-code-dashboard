import Link from "next/link"
import { ArrowRight } from "lucide-react"
import type { DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import { countOutsideSessions } from "@/lib/homeDashboard"

interface OutsideSessionsListProps {
  sessions: DesktopSessionSummary[]
  /** 組織図にカードとして出ているセッションのID。組織図のデータがまだ無いときは null */
  shownIds: string[] | null
  /** 組織図のデータを取れなかった(どれが組織図に出ているか分からない) */
  failed?: boolean
}

/**
 * ホームの「組織図に出ていないセッション」(⑧)。ほかのグループ・指揮役のいないグループ・グループに入っていないセッションの件数と、
 * セッション一覧への入口だけを出す(⑬ の棚卸しの行7。判断の要るものは「次にやる判断」に入るので、行は並べない)。
 */
export function OutsideSessionsList({ sessions, shownIds, failed = false }: OutsideSessionsListProps) {
  // 組織図が済むまでは出さない(画面の外にあり、組織図に出たセッションが分かるまで作れないため。⑫ ST-6)
  if (shownIds === null && !failed) return null
  const link = (
    <Link href="/desktop-sessions" className="inline-flex items-center gap-1 text-primary hover:underline">
      セッション一覧ですべて見る <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  )
  if (shownIds === null) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="home-outside">
        組織図のデータを取得できないため、組織図に出ていないセッションを数えられません。{link}
      </p>
    )
  }
  const total = countOutsideSessions(sessions, new Set(shownIds))
  return (
    <p className="text-sm text-muted-foreground" data-testid="home-outside">
      組織図に出ていないセッション（ほかのグループ・グループ外など。アーカイブ済みとサイドチャットは除く）：
      <span className="font-medium text-foreground tabular-nums" data-testid="home-outside-count">
        {total}件
      </span>
      。{link}
    </p>
  )
}
