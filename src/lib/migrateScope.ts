/**
 * 移行(エクスポート / インポート)で、別のPCへ移るもの・移らないもの。移行のページに出す。
 * エクスポートの形式(exportImport.ts の buildExportBundle)を変えたら、ここも合わせる(migrateScope.test.ts が気づかせる)。
 */
export const MIGRATE_INCLUDED: readonly string[] = [
  "ルール（CLAUDE.md の「## 見出し」ごとの節。オン・オフも移る）",
  "スキル（SKILL.md の本文と、名前・説明などの見出しの項目）",
]

export const MIGRATE_EXCLUDED: readonly string[] = [
  "CLAUDE.md の最初の見出しより前の文",
  "スキルの有効・無効（無効のスキルも、有効として入る）",
  "スキルのフォルダの中の、SKILL.md 以外のファイルと、アーカイブした過去の版",
  "settings.json（「設定」のページで編集するもの）",
  "記憶（メモリ）",
  "MCP・プラグイン",
  "このアプリのプロジェクトの登録と、通知の設定",
]

export const MIGRATE_IMPORT_NOTE =
  "インポートは、選んだ項目を足す・上書きするだけで、今あるルールやスキルは消しません（上書きする前に退避します）。"
