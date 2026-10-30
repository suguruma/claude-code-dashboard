/**
 * 関係性マップ(⑬ 組織のページの「つながり」。RM-1〜RM-8)の API・画面で共有する型。サーバー専用モジュールを import しない。
 * ここに載せる項目が「API が返してよい項目」になる。ファイルの本文・パス・メッセージの本文は返さない
 * (指示のファイル・報告の台帳は見出しの番号と更新時刻だけ。決まり・記憶は名前と更新時刻と効く先だけ)。
 */

export type RelationRole = "leader" | "member" | "helper"

/** 画面の役割名。設定(`config/relations.json` の `roleLabels`)で上書きできる */
export interface RoleLabels {
  leader: string
  member: string
  helper: string
}

export const DEFAULT_ROLE_LABELS: RoleLabels = { leader: "指揮役", member: "担当", helper: "確認役・補助" }

/** 指示のファイル・報告の台帳の、最後の見出しの番号と更新時刻(設定で担当と結んだときだけ) */
export interface LedgerMark {
  /** ファイルの名前だけ(フォルダのパスは返さない) */
  name: string
  /** 最後の見出しの番号(「### 指示43:」の 43)。見出しが無ければ null */
  lastNumber: number | null
  updatedAt: number | null
  /** ok: 読めた / missing: 無い / refused: 拒否リストに当たった / unreadable: 読めなかった */
  status: "ok" | "missing" | "refused" | "unreadable"
}

export interface RelationSession {
  id: string
  title: string
  /** グループの ID。グループに入っていなければ null */
  groupId: string | null
  role: RelationRole
  /** 立てた記録(spawnedFrom)があるときだけ */
  spawnedFromId: string | null
  status: string
  folderName: string | null
  /** 書き込んだブランチ。分からなければ null(カードには書かない) */
  branch: string | null
  /** 同じ作業フォルダを使っている、ほかのセッションの ID */
  sameFolderIds: string[]
  /** 設定で結んだ指示のファイル・報告の台帳。結んでいなければ null(カードには書かない) */
  orders: LedgerMark | null
  reports: LedgerMark | null
  lastActivityAt: number | null
}

export interface RelationGroup {
  /** グループに入っていないセッションは "none" */
  id: string
  name: string
  count: number
  /** 次にやる判断の数(⑬ 段1 と同じ数え方) */
  decisions: number
  /** このグループから出た、返事の無いグループをまたぐ頼みの数 */
  unansweredRequests: number
  /** 立てた記録(spawnedFrom)のあるセッションの数。0 なら一覧に「立てた線なし」 */
  spawnedLinks: number
}

/** 効いているもの(決まり・記憶・スキル・指示ファイル)の1つ。効く先はセッションの ID の一覧 */
export interface EffectItem {
  key: string
  /** 名前(フォルダの最後の名前など。パスは返さない) */
  label: string
  updatedAt: number | null
  sessionIds: string[]
  /** 記憶のファイル数など、名前に添える数 */
  count?: number
}

export interface RelationEffects {
  /** 全体の決まり(グローバルの CLAUDE.md)。全セッションに効く。status は ok・missing・disabled */
  global: { status: "ok" | "missing" | "disabled"; updatedAt: number | null }
  /** 作業フォルダの決まり(作業フォルダとその上のフォルダの CLAUDE.md)。クラウドのフォルダは調べない */
  folderRules: EffectItem[]
  /** 記憶(会話ログの置き場の memory) */
  memories: EffectItem[]
  /** ユーザーのスキルの数(全セッションに効く)。場所を調べないときは null */
  userSkills: number | null
  /** 直近30日に呼んだスキル(全セッションの会話ログの呼び出しを全部集めた数) */
  usedSkills: Array<{ name: string; calls: number; sessionIds: string[] }>
  /** クラウドのフォルダにあるので調べなかった作業フォルダの数 */
  cloudSkipped: number
}

/** グループをまたぐ頼み(peerReceipts の宛先が別のグループのもの)。本文は返さず、要旨の先頭20字だけ */
export interface CrossGroupRequest {
  fromId: string
  toId: string
  /** 要旨の先頭20字(組織図と同じ切り出し。秘密らしい文字とパスは伏せる)。送った記録と会話ログの送信を結べなければ null */
  summary: string | null
  fromGroupId: string | null
  toGroupId: string | null
  sentAt: number | null
  delivery: "delivered" | "undelivered" | "queued" | "unknown"
  deliveredAt: number | null
  readAt: number | null
  repliedAt: number | null
}

export interface RelationsResponse {
  generatedAt: number
  /** グループをまたぐ頼みを数える期間(ミリ秒。この期間に送ったものだけ) */
  crossWindowMs: number
  /** ok: Claude Desktop のデータがある / no-desktop: 無い(グループが分からない) */
  status: "ok" | "no-desktop"
  /** `config/relations.json` があるか(無ければ、指示の置き場の札を出さない) */
  configured: boolean
  roleLabels: RoleLabels
  groups: RelationGroup[]
  sessions: RelationSession[]
  effects: RelationEffects
  crossGroup: CrossGroupRequest[]
}

/** 頼みの返事の具合の文(届いた・読んだ・返事した。色だけに頼らない) */
export function deliveryText(r: Pick<CrossGroupRequest, "delivery" | "readAt" | "repliedAt">): string {
  if (r.repliedAt !== null) return "返事あり"
  if (r.readAt !== null) return "読んだ・返事なし"
  if (r.delivery === "delivered") return "届いた・未読"
  if (r.delivery === "undelivered") return "届かなかった"
  if (r.delivery === "queued") return "送る順番を待っている"
  return "分からない"
}
