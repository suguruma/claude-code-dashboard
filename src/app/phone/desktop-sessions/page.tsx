import { Suspense } from "react"
import { PhoneSessions } from "@/components/phone/PhoneSessions"

export default function PhoneSessionsPage() {
  // 絞り込みを URL の検索で持つ(useSearchParams)ため、静的生成のために Suspense で包む
  return (
    <Suspense fallback={<p className="py-6 text-center text-base text-muted-foreground">読み込み中...</p>}>
      <PhoneSessions />
    </Suspense>
  )
}
