import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { DesktopSessionListResponse } from "@/lib/desktopSessionTypes"

/**
 * セッション一覧のデータを読むときの案内(読み込みエラー・データなし・縮退表示のお知らせ・読み込み中)。
 * セッション一覧と組織図の両方で同じ文言を出す。
 */
export function DesktopDataNotices({
  data,
  error,
  isLoading,
}: {
  data: DesktopSessionListResponse | null
  error: Error | undefined
  isLoading: boolean
}) {
  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>読み込みエラー</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {data?.source === "none" && (
        <Alert>
          <AlertTitle>セッションが見つかりません</AlertTitle>
          <AlertDescription>
            Claude Desktopのデータフォルダも、会話ログ（<code className="font-mono">~/.claude/projects/</code>）も見つかりませんでした。
            データフォルダが標準の場所にない場合は、設定ファイル <code className="font-mono">config/desktop-sessions.json</code> の
            <code className="font-mono"> dataDir</code> で指定できます。
          </AlertDescription>
        </Alert>
      )}

      {data?.warnings.map((warning) => (
        <Alert key={warning} variant={data.source === "transcript-only" ? "destructive" : "default"}>
          <AlertTitle>{data.source === "transcript-only" && warning === data.warnings[0] ? "縮退表示" : "お知らせ"}</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      {isLoading && !data && <p className="text-sm text-muted-foreground">読み込み中...</p>}
    </>
  )
}
