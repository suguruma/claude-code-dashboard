/**
 * 組織のルールのページ(⑨)の API・画面で共有する型。サーバー専用モジュールをimportしない(クライアントからも参照する)。
 * ここに載せる項目が「API が返してよい項目」になる。記憶の本文は一覧の応答に入れず、開いたときだけ別の API で返す。
 */

/** 本文の中の「NN_題名」が、今のセッションの題名と合わないことの印 */
export interface StaleRef {
  /** 本文から取り出した語(例: 05_画面の修正) */
  text: string
  /** mismatch: 今の題名と合わない / archived: アーカイブ済みのセッションの題名とだけ合う */
  kind: "mismatch" | "archived"
  /** 手がかり: 同じ番号の今の題名 */
  sameNumber: string[]
  /** 手がかり: 同じ名前(番号を除いた部分)の今の題名 */
  sameName: string[]
}

export interface OrgRuleSection {
  title: string
  /** CCD:DISABLED で無効にした節は false */
  enabled: boolean
  body: string
  staleRefs: StaleRef[]
  /** 先頭に出す節(グローバルの CLAUDE.md の「組織の運用」「セッションの題名」など)。画面では開いた状態で出す */
  pinned?: boolean
}

/**
 * 読んだファイル1つ。status は、ok: 読めた / missing: 無い / disabled: 自動の探索を止めていて場所の指定が無い /
 * wsl: この PC からは読めない(WSL の作業フォルダ) / refused: 拒否リストに当たった / unsupported: .md・.txt 以外 /
 * too-large: 大きすぎる / unreadable: 読み込みに失敗した
 */
export type OrgFileStatus = "ok" | "missing" | "disabled" | "wsl" | "refused" | "unsupported" | "too-large" | "unreadable"

export interface OrgRuleFile {
  status: OrgFileStatus
  path: string | null
  updatedAt: number | null
  /** 見出しより前の文(タイトルなど) */
  preamble: string
  sections: OrgRuleSection[]
}

export interface OrgMemoryEntry {
  fileName: string
  name: string
  description: string
  type: string
  updatedAt: number | null
  /** 本文の中の、今の題名と合わない「NN_題名」の数(本文そのものは返さない) */
  staleCount: number
  /** MEMORY.md(索引)に載っていない */
  notInIndex: boolean
}

/** 記憶。status は、ok / missing: 記憶のフォルダが無い / unknown: 場所が分からない(会話ログが見つからない) / wsl */
export interface OrgMemory {
  status: "ok" | "missing" | "unknown" | "wsl"
  entries: OrgMemoryEntry[]
  typeCounts: Record<string, number>
  /** MEMORY.md があるか(無ければ、索引とのずれは調べない) */
  hasIndex: boolean
  /** 索引が指しているのに、無いファイル */
  missingFromDisk: string[]
}

/** 作業フォルダごとのカード。同じ作業フォルダの指揮役が複数のグループにいれば、1枚にまとめる */
export interface OrgFolderCard {
  /** 記憶の本文を取りに行くときに使う識別子(サーバーが作る。パスは受け取らない) */
  key: string
  cwd: string
  groups: Array<{ groupName: string; leaderTitle: string }>
  claudeMd: OrgRuleFile
  memory: OrgMemory
}

export interface OrgExtraFile {
  label: string
  file: OrgRuleFile
}

export interface OrgRulesResponse {
  generatedAt: number
  global: OrgRuleFile
  /** ok: 指揮役を探せた / no-desktop: Claude Desktop のデータが無く、指揮役を探せない */
  foldersStatus: "ok" | "no-desktop"
  folders: OrgFolderCard[]
  extras: OrgExtraFile[]
  /** 古い名前の判定ができたか(Claude Desktop のデータが無いと、比べる題名が無い) */
  staleChecked: boolean
  /** 古い名前の印の合計(記憶は本文の分も含む) */
  staleTotal: number
}

export interface OrgMemoryBodyResponse {
  fileName: string
  body: string
  staleRefs: StaleRef[]
}
