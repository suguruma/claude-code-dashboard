"use client"

import { Suspense } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { HousekeepingView } from "@/components/desktopSessions/HousekeepingView"
import { SessionDetailDialog } from "@/components/desktopSessions/SessionDetailDialog"
import { useHousekeeping } from "@/hooks/useHousekeeping"
import { useSelectedSession } from "@/hooks/useSelectedSession"

export default function HousekeepingPage() {
  // useSearchParams を使うため、静的生成時のためにSuspenseで包む
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">読み込み中...</p>}>
      <HousekeepingContent />
    </Suspense>
  )
}

function HousekeepingContent() {
  const { data, error, isLoading } = useHousekeeping()
  const [selectedId, setSelectedId] = useSelectedSession()

  return (
    <div className="space-y-6">
      {error && !data && (
        <Alert variant="destructive">
          <AlertTitle>読み込みエラー</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      {!data && isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}

      {data && <HousekeepingView data={data} onSelect={setSelectedId} />}

      <SessionDetailDialog
        sessionId={selectedId}
        highContextRatio={data?.cleanup.highContextRatio ?? 0.8}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}
