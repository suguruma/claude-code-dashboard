import {
  Activity,
  ArrowLeftRight,
  BrainCircuit,
  BrushCleaning,
  Gauge,
  HelpCircle,
  Home,
  LayoutDashboard,
  MonitorSmartphone,
  LineChart,
  ListChecks,
  ListTodo,
  Settings as SettingsIcon,
  Sparkles,
  ScrollText,
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
  /**
   * 選んでいるプロジェクトを使うページか。true のページだけ、上のバーにプロジェクトの切り替えと
   * 「グローバル設定」の印を出す(⑧。ページごとの出す・出さないは、この1か所で変えられる)
   */
  usesProject?: boolean
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      {
        href: "/",
        label: "ホーム",
        icon: Home,
        description:
          "判断待ち・送信上限で停止・利用上限を上に、その下に組織図（指揮役から各セッションへの指示と、各セッションからの報告の動き）を出します。組織図に出ていないセッションは、いちばん下にまとめます（読み取り専用）。",
      },
    ],
  },
  {
    // Claude Desktopのセッションを見る画面。情報量が多いため、見たい内容ごとにページを分ける。
    // 組織図はホームに出す(⑧。/desktop-sessions/org はホームへ移る)
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
      {
        // ⑨。指揮役の見つけ方が Desktop のグループに頼るので、この群に置く。選んでいるプロジェクトは使わない
        href: "/org-rules",
        label: "組織のルール",
        icon: ScrollText,
        usesProject: false,
        description:
          "全グループ共通の決まり（グローバルの CLAUDE.md）と、グループごとの指揮役の決まり（作業フォルダの CLAUDE.md と記憶）を、1か所で読みます。番号の入れ替えなどで古くなったセッション名に印を付けます（読み取り専用）。",
      },
    ],
  },
  {
    // 選択中のプロジェクトに紐づく設定の管理(ヘルプの「設定管理の対象」と同じ範囲)
    label: "設定管理",
    items: [
      { href: "/project", label: "プロジェクトの概要", icon: LayoutDashboard, usesProject: true },
      { href: "/rules", label: "ルール管理", icon: ListChecks, usesProject: true },
      { href: "/skills", label: "スキル管理", icon: Sparkles, usesProject: true },
      { href: "/memory", label: "メモリ管理", icon: BrainCircuit, usesProject: true },
      { href: "/settings", label: "設定", icon: SettingsIcon, usesProject: true },
    ],
  },
  {
    label: "分析・振り返り",
    items: [
      { href: "/trace", label: "実行ログ", icon: Activity, usesProject: true },
      // セッション監視は選んでいるプロジェクトを使わない(~/.claude/projects を直接読む)ので、切り替えを出さない(⑧ Q5)
      { href: "/session-monitor", label: "セッション監視", icon: LineChart, usesProject: false },
      { href: "/tasks", label: "タスク履歴", icon: ListTodo, usesProject: true },
    ],
  },
  {
    label: "ツール",
    items: [
      // 選んでいるプロジェクトへ書き込むので、対象が見えるよう切り替えを出す(⑧ Q6)
      { href: "/migrate", label: "移行", icon: ArrowLeftRight, usesProject: true },
      { href: "/refactor", label: "ルール整理", icon: Wand2, usesProject: true },
    ],
  },
]

/** グループ分けされたナビとは別に、サイドバー下部に常時表示するヘルプリンク */
export const HELP_ITEM: NavItem = { href: "/help", label: "使い方ガイド", icon: HelpCircle }

/** 上のバーにプロジェクトの切り替えを出すか。サイドバーの項目の usesProject で決める(項目に無いページには出さない) */
export function showsProjectSwitcher(pathname: string): boolean {
  return findNavItem(pathname)?.usesProject === true
}

export function findNavItem(pathname: string): NavItem | null {
  if (HELP_ITEM.href === pathname) return HELP_ITEM
  for (const group of NAV_GROUPS) {
    const found = group.items.find((item) => item.href === pathname)
    if (found) return found
  }
  return null
}
