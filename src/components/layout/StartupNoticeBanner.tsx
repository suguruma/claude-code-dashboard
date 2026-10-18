"use client"

import { useEffect, useState } from "react"
import { Info, X } from "lucide-react"
import type { StartupNotice } from "@/types/electron"

/**
 * 起動の通知は、画面を読み込んだ最初の1回だけ、メインプロセスから受け取る（メインプロセスが渡したあとは空にする）。
 * 同じ読み込みの中では結果を使い回すので、開発時の二重実行でも消えない。再読み込みすると受け取れず、帯は出ない。
 */
let noticeRequest: Promise<StartupNotice | null> | null = null
function requestStartupNotice(): Promise<StartupNotice | null> {
  if (!noticeRequest) {
    const api = window.electronAPI
    noticeRequest = api?.getStartupNotice ? api.getStartupNotice().catch(() => null) : Promise.resolve(null)
  }
  return noticeRequest
}

function isPortFallback(notice: StartupNotice | null): notice is StartupNotice {
  return (
    notice !== null &&
    notice.kind === "port-fallback" &&
    Number.isInteger(notice.port) &&
    Number.isInteger(notice.preferredPort)
  )
}

/**
 * 画面の上部に、起動の通知を1回だけ出す帯。配布exeで、優先ポートが使えず別のポートで起動したときだけ出る
 * （ブラウザで開いたときや、優先ポートで起動できたときは何も出ない）。ポートが変わると、画面の設定
 * （サイドバーの折りたたみ・絞り込みなど）の保存先が変わるため、その旨を知らせる。
 */
export function StartupNoticeBanner() {
  const [notice, setNotice] = useState<StartupNotice | null>(null)

  useEffect(() => {
    let alive = true
    void requestStartupNotice().then((n) => {
      if (alive && isPortFallback(n)) setNotice(n)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!notice) return null
  const detail =
    `優先ポート${notice.preferredPort}が使えなかったため（別のアプリが使っているか、前回のサーバーが残っている可能性があります）、` +
    `ポート${notice.port}で起動しています。この起動の間は、サイドバーの折りたたみや絞り込みなど、画面の設定が通常と別扱いになります。`
  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-[var(--status-warning)] bg-[color-mix(in_oklab,var(--status-warning)_14%,transparent)] px-4 py-2 text-sm"
    >
      <Info className="mt-0.5 size-4 shrink-0" style={{ color: "var(--status-warning)" }} aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">別のポートで起動しました</span>
        <span className="ml-2 text-foreground/80">{detail}</span>
      </p>
      <button
        type="button"
        onClick={() => setNotice(null)}
        aria-label="閉じる"
        className="shrink-0 rounded p-0.5 hover:bg-accent"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
