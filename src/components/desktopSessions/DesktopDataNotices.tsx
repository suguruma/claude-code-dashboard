import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { autodetectStoppedNote, dataLocationText } from "@/lib/dataLocationText"
import type { DataLocation, DesktopSessionListResponse } from "@/lib/desktopSessionTypes"

/**
 * セッション一覧のデータを読むときの案内(読み込みエラー・データなし・縮退表示のお知らせ・読み込み中)と、
 * 読んでいるデータの場所の出どころ(⑧-2)。セッション一覧とホームの両方で同じ文言を出す。
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
            {/* 撮影者が枠だけを見て「Desktop が無い」と読まないよう、スイッチで止めているときはその旨も出す(⑧-3) */}
            {data.dataLocation && autodetectStoppedNote(data.dataLocation) && (
              <span className="mt-1 block font-medium" data-testid="autodetect-stopped">
                {autodetectStoppedNote(data.dataLocation)}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {data?.warnings.map((warning) => (
        <Alert key={warning} variant={data.source === "transcript-only" ? "destructive" : "default"}>
          <AlertTitle>{data.source === "transcript-only" && warning === data.warnings[0] ? "縮退表示" : "お知らせ"}</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      {data?.dataLocation && <DataLocationLine location={data.dataLocation} />}

      {isLoading && !data && <p className="text-sm text-muted-foreground">読み込み中...</p>}
    </>
  )
}

/** 読んでいるデータの場所の出どころを1行で出す。フォルダのパスは、開いたときだけ出す(画像にパスが写らないように) */
function DataLocationLine({ location }: { location: DataLocation }) {
  const text = dataLocationText(location)
  if (!location.path) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="data-location">
        {text}
      </p>
    )
  }
  return (
    <details className="text-xs text-muted-foreground" data-testid="data-location">
      <summary className="cursor-pointer">{text}</summary>
      <code className="mt-1 block font-mono break-all">{location.path}</code>
    </details>
  )
}
