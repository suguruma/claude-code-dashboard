/**
 * ダッシュボードが作る退避(`.ccd-backup.<epoch>`・削除済みスキル)の保持方針。
 * 退避がたまり続けないよう、古いものから自動で削除する。純粋な関数にして、判定だけを単体でテストできるようにしている。
 *
 * - 同じ対象(ファイル・スキル名)ごとに、新しい順に最大 RETENTION_MAX_COUNT 世代まで残す
 * - そのうち RETENTION_MAX_AGE_DAYS 日より古いものは削除する
 * - ただし最新の RETENTION_ALWAYS_KEEP 世代は、古くても必ず残す(しばらく触っていない設定でも最後の退避は失わない)
 */
export const RETENTION_MAX_COUNT = 30
export const RETENTION_MAX_AGE_DAYS = 90
export const RETENTION_ALWAYS_KEEP = 5

const DAY_MS = 24 * 60 * 60 * 1000

export interface RetentionCandidate {
  name: string
  /** 退避した時刻(epoch ms)。新しい順の判定と期間の判定に使う */
  timestampMs: number
}

/** 削除すべき候補の名前を返す。渡された候補は、すべて同じ対象の退避であること */
export function selectExpired(candidates: RetentionCandidate[], nowMs: number): string[] {
  const sorted = [...candidates].sort((a, b) => b.timestampMs - a.timestampMs)
  const expired: string[] = []
  sorted.forEach((c, index) => {
    if (index < RETENTION_ALWAYS_KEEP) return
    const tooMany = index >= RETENTION_MAX_COUNT
    const tooOld = nowMs - c.timestampMs > RETENTION_MAX_AGE_DAYS * DAY_MS
    if (tooMany || tooOld) expired.push(c.name)
  })
  return expired
}
