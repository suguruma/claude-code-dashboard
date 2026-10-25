import { ExternalLink } from "lucide-react"
import { CLOUD_SESSIONS_NOTE, CLOUD_SESSIONS_URL } from "@/lib/cloudSessions"

/**
 * クラウドのセッションを claude.ai で開くボタン(⑬ CL-1)。ホームの組織図のグループの並びの最後に置く。
 * ブラウザは新しいタブで開き、exe は新しい窓を開く代わりに既定のブラウザで開く(electron/main.js の setWindowOpenHandler と許可リスト)。
 */
export function CloudSessionsLink() {
  return (
    // ボタンと1行は、グループの並び(flex-wrap)の別々の項目にする。ボタンはグループの続きに並び、入りきらない1行だけが次の行に回る
    <>
      <a
        href={CLOUD_SESSIONS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        data-testid="cloud-sessions-link"
      >
        クラウドのセッション（claude.ai で開く
        <ExternalLink className="size-3.5" aria-hidden />）
      </a>
      <span className="self-center text-sm text-muted-foreground">{CLOUD_SESSIONS_NOTE}</span>
    </>
  )
}
