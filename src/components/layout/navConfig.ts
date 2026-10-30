import {
  Activity,
  ArrowLeftRight,
  BrushCleaning,
  Gauge,
  HelpCircle,
  Home,
  MonitorSmartphone,
  ListChecks,
  Settings as SettingsIcon,
  Sparkles,
  ScrollText,
  Smartphone,
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
  /** 名前の横に出す印。pc-alert：今日 PC の警告(CPU・メモリ)があったら文字「！」(⑭ WC-6) */
  mark?: "pc-alert"
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
          "いまあなたが決めることを急ぐ順に上に出し、その下に組織図を出します（読み取り専用）。",
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
        // ⑭。前の「利用上限」。上のタブで利用上限・作業と待ち・負荷(CPU とメモリ)を切り替える。
        // サイドバーから開くと、いつも［利用上限］(タブの前回の選択は覚えない)
        href: "/desktop-sessions/usage",
        label: "リソース",
        icon: Gauge,
        mark: "pc-alert",
        description:
          "利用上限のゲージと誰が使っているか、各セッションの作業の順番と利用上限の回復の待ち、PC の CPU とメモリの負荷を見ます（読み取り専用）。",
      },
      {
        href: "/desktop-sessions/housekeeping",
        label: "整理",
        icon: BrushCleaning,
        description:
          "返事の来ていない指示と、コンテキストが大きい・長く止まっているセッション（再開すると上限をどれだけ使うかの目安つき）を、1画面にまとめます。次にやる判断はホームで見ます。対処はセッションを開いて行います（読み取り専用）。",
      },
      {
        // ⑨・⑬。指揮役の見つけ方が Desktop のグループに頼るので、この群に置く。選んでいるプロジェクトは使わない。
        // 上のタブで「決まり」(⑨)と「つながり」(⑬ の関係性マップ)を切り替える
        href: "/org-rules",
        label: "組織",
        icon: ScrollText,
        usesProject: false,
        description:
          "「決まり」では全体とグループごとの決まり（CLAUDE.md と記憶）を読み、「つながり」では誰がどのグループにいて、何が効いているかを見ます（読み取り専用）。",
      },
    ],
  },
  {
    // 選択中のプロジェクトに紐づく設定の管理(ヘルプの「設定管理の対象」と同じ範囲)
    label: "設定管理",
    items: [
      { href: "/rules", label: "ルール管理", icon: ListChecks, usesProject: true },
      { href: "/skills", label: "スキル管理", icon: Sparkles, usesProject: true },
      { href: "/settings", label: "設定", icon: SettingsIcon, usesProject: true },
    ],
  },
  {
    label: "分析・振り返り",
    items: [
      { href: "/trace", label: "実行ログ", icon: Activity, usesProject: true },
      // 振り返りのスキル(rule-optimizer)の結果を読む(⑬ で「ツール」から移した)
      { href: "/refactor", label: "ルール整理", icon: Wand2, usesProject: true },
    ],
  },
  {
    label: "ツール",
    items: [
      // 選んでいるプロジェクトへ書き込むので、対象が見えるよう切り替えを出す(⑧ Q6)
      { href: "/migrate", label: "移行", icon: ArrowLeftRight, usesProject: true },
      {
        // ⑪。オン・オフと端末の管理は、この PC の画面からだけ(LAN の入り口は、このページを通さない)
        href: "/lan-access",
        label: "スマホから見る",
        icon: Smartphone,
        usesProject: false,
        description:
          "同じ家の Wi-Fi のスマホから、ホーム・セッション一覧・利用上限・整理の4ページを読み取り専用で見られるようにします。既定はオフです。オンにして「登録コードを出す」を押し、出てきた QR コードをスマホで読み取ると、その端末が登録されます。書き込みは PC からだけです。",
      },
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
