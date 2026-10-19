import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import { PhoneShell } from "@/components/phone/PhoneShell"

/**
 * スマホ用のページ(⑪-2)。LAN の入り口の経由の要求だけを、proxy がここへ振り替える(URL は今の4ページのまま)。
 * PC の枠(サイドバー・上のバー・通知の見張り)は出さず、スマホ用の枠を出す。ノッチの下まで描いて safe-area でよける。
 */
export const metadata: Metadata = {
  title: "Claude Code Dashboard（スマホ）",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function PhoneLayout({ children }: { children: ReactNode }) {
  return <PhoneShell>{children}</PhoneShell>
}
