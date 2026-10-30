"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { HousekeepingView } from "@/components/desktopSessions/HousekeepingView"
import { SelectedSessionDialog } from "@/components/desktopSessions/SelectedSessionDialog"
import { useHousekeeping } from "@/hooks/useHousekeeping"
import { useSelectSession } from "@/hooks/useSelectedSession"

/** ページ全体は Suspense で包まない。`?session=` を読むのは詳細のダイアログだけ(SelectedSessionDialog) */
export default function HousekeepingPage() {
  const { data, error, isLoading } = useHousekeeping()
  const setSelectedId = useSelectSession()

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

      <SelectedSessionDialog highContextRatio={data?.cleanup.highContextRatio ?? 0.8} />
    </div>
  )
}
