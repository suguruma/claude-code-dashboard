import {
  Activity,
  ArrowLeftRight,
  BrainCircuit,
  BrushCleaning,
  Gauge,
  HelpCircle,
  Home,
  MonitorSmartphone,
  LineChart,
  ListChecks,
  ListTodo,
  Network,
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
  /** ページの見出しの下に出す一文(任意) */
  description?: string
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  { items: [{ href: "/", label: "ホーム", icon: Home }] },
  {
    // 選択中のプロジェクトに紐づく設定の管理(ヘルプの「設定管理の対象」と同じ範囲)
    label: "設定管理",
    items: [
      { href: "/rules", label: "ルール管理", icon: ListChecks },
      { href: "/skills", label: "スキル管理", icon: Sparkles },
      { href: "/memory", label: "メモリ管理", icon: BrainCircuit },
      { href: "/settings", label: "設定", icon: SettingsIcon },
    ],
  },
  {
    // Claude Desktopのセッションを見る画面。情報量が多いため、見たい内容ごとにページを分ける
    label: "Claude Desktop",
    items: [
      {
        href: "/desktop-sessions",
        label: "セッション一覧",
        icon: MonitorSmartphone,
        description:
          "Claude Desktopの全セッションを一覧し、どれが動いていて、どれが止まっているかを確認します（読み取り専用・5秒ごとに更新）。状態の「実行中」「中断の可能性」は、会話ログの更新状況からの推定です。",
      },
      {
        href: "/desktop-sessions/org",
        label: "組織図",
        icon: Network,
        description:
          "グループごとに、指揮役から各セッションへの指示と、各セッションからの報告を、動きで見ます。ライブでは今の様子を、振り返りでは過去の流れを再生できます（読み取り専用）。",
      },
      {
        href: "/desktop-sessions/usage",
        label: "利用上限",
        icon: Gauge,
        description:
          "5時間・週・週のモデル別の利用上限のゲージと、誰が使っているかを見ます。公式値と、会話記録からの推定を並べます（読み取り専用）。",
      },
      {
        href: "/desktop-sessions/housekeeping",
        label: "整理",
        icon: BrushCleaning,
        description:
          "コンテキストが大きい・長く止まっているセッション（再開すると上限をどれだけ使うかの目安つき）、返事の来ていない指示、あなたの判断を待っているセッションを、1画面にまとめます。対処はセッションを開いて行います（読み取り専用）。",
      },
    ],
  },
  {
    label: "分析・振り返り",
    items: [
      { href: "/trace", label: "実行ログ", icon: Activity },
      { href: "/session-monitor", label: "セッション監視", icon: LineChart },
      { href: "/tasks", label: "タスク履歴", icon: ListTodo },
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
