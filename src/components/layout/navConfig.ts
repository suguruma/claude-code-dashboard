import {
  Activity,
  ArrowLeftRight,
  BrainCircuit,
  HelpCircle,
  Home,
  LineChart,
  ListChecks,
  ListTodo,
  Settings as SettingsIcon,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  disabled?: boolean
  disabledReason?: string
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  { items: [{ href: "/", label: "ホーム", icon: Home }] },
  {
    label: "設定管理",
    items: [
      { href: "/rules", label: "ルール管理", icon: ListChecks },
      { href: "/skills", label: "スキル管理", icon: Sparkles },
      { href: "/settings", label: "設定", icon: SettingsIcon },
    ],
  },
  {
    label: "分析・振り返り",
    items: [
      { href: "/trace", label: "実行ログ", icon: Activity },
      { href: "/session-monitor", label: "セッション監視", icon: LineChart },
      { href: "/tasks", label: "タスク履歴", icon: ListTodo },
      { href: "/memory", label: "メモリ管理", icon: BrainCircuit },
    ],
  },
  {
    label: "ツール",
    items: [
      { href: "/migrate", label: "移行", icon: ArrowLeftRight },
      { href: "/refactor", label: "ルール整理", icon: Wand2 },
    ],
  },
]

/** グループ分けされたナビとは別に、サイドバー下部に常時表示するヘルプリンク */
export const HELP_ITEM: NavItem = { href: "/help", label: "使い方ガイド", icon: HelpCircle }

export function findNavItem(pathname: string): NavItem | null {
  if (HELP_ITEM.href === pathname) return HELP_ITEM
  for (const group of NAV_GROUPS) {
    const found = group.items.find((item) => item.href === pathname)
    if (found) return found
  }
  return null
}
