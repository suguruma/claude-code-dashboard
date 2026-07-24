import {
  Activity,
  ArrowLeftRight,
  BrainCircuit,
  Cpu,
  Home,
  LineChart,
  ListChecks,
  ListTodo,
  Settings as SettingsIcon,
  Sparkles,
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
      {
        href: "/refactor",
        label: "GPUモード",
        icon: Cpu,
        disabled: true,
        disabledReason: "GPUモード（機能3）は次回実装予定です",
      },
    ],
  },
]

export function findNavItem(pathname: string): NavItem | null {
  for (const group of NAV_GROUPS) {
    const found = group.items.find((item) => item.href === pathname)
    if (found) return found
  }
  return null
}
