/**
 * ⑬ の機能の整理(FS-1)でやめたページと、その行き先。今までのブックマークや古いリンクが 404 にならないよう、
 * next.config.ts の redirects で行き先へ移す(一時的な移動の 307。行き先が変わっても、ブラウザに覚えさせない)。
 * 行き先が無いページはホームへ。ここはファイルにも通信にも触れない(next.config.ts から読むため)。
 */
export const REMOVED_PAGES: ReadonlyArray<{ source: string; destination: string; reason: string }> = [
  // 4つの数と入口のカード(棚卸しの行28)。入口はサイドバーと重なる。プロジェクトの切り替えは上のバーに残る
  { source: "/project", destination: "/", reason: "入口はサイドバーと重なる" },
  // 読む元(~/.claude/tasks)が無い(行40)
  { source: "/tasks", destination: "/", reason: "読む元のフォルダが無い" },
  // 記憶の一覧は、組織の「決まり」へまとめた(行34)
  { source: "/memory", destination: "/org-rules?tab=rules#org-memory", reason: "組織の「決まり」へまとめた" },
  // 診断の4つの観点と AI 診断は、セッション一覧の詳細の「健康」へ移した(行25・27)
  { source: "/session-monitor", destination: "/desktop-sessions", reason: "セッション一覧の詳細の「健康」へ移した" },
]
