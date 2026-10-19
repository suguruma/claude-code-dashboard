import type { DataLocation } from "./desktopSessionTypes"

/**
 * 読んでいる Claude Desktop のデータの場所の出どころを、画面のお知らせの1行にする(⑧-2)。
 * サーバー専用モジュールをimportしない(クライアントからも使う)。場所(パス)は、行を開いたときだけ出す。
 */
export function dataLocationText(location: DataLocation): string {
  const head = "読んでいる Claude Desktop のデータ："
  switch (location.origin) {
    case "explicit-config":
      return `${head}設定ファイル（config/desktop-sessions.json）で指定したフォルダ${location.path ? "" : "（見つかりません）"}`
    case "explicit-env":
      return `${head}環境変数 CLAUDE_DESKTOP_DATA_DIR で指定したフォルダ${location.path ? "" : "（見つかりません）"}`
    case "auto":
      return location.path ? `${head}自動で見つけたフォルダ` : `${head}自動で探しましたが、見つかりません`
    case "disabled":
      return `${head}自動で探すのを止めています（CCD_DESKTOP_AUTODETECT=0）。設定ファイルか環境変数で指定したフォルダだけを読みます`
  }
}
