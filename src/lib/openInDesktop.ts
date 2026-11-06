import { toast } from "sonner"

/**
 * Claude Desktop でセッションを開くだけ(答えは送らない)。配布exeはメインプロセス経由(許可した形式のURLだけ)、
 * ブラウザはリンクの遷移で開く。セッション一覧の［セッションを開く］と、探すの Shift+Enter(⑮ OR-5)で使う
 */
export async function openInDesktop(link: string): Promise<void> {
  const api = typeof window === "undefined" ? undefined : window.electronAPI
  if (api?.openExternal) {
    const result = await api.openExternal(link)
    if (!result.ok) toast.error("セッションを開けませんでした。Claude Desktopが起動しているか確認してください")
    return
  }
  window.location.href = link
}
