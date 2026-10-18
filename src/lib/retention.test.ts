import { describe, expect, it } from "vitest"
import {
  RETENTION_ALWAYS_KEEP,
  RETENTION_MAX_AGE_DAYS,
  RETENTION_MAX_COUNT,
  selectExpired,
} from "./retention"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 18)

/** n日前の退避を、新しい順に並べて作る */
function daysAgo(...days: number[]) {
  return days.map((d) => ({ name: `b-${d}`, timestampMs: NOW - d * DAY }))
}

describe("selectExpired", () => {
  it("件数も期間も範囲内なら何も削除しない", () => {
    expect(selectExpired(daysAgo(0, 1, 2, 10, 30), NOW)).toEqual([])
  })

  it("期間(90日)を超えた古い退避は削除する", () => {
    const candidates = daysAgo(0, 1, 2, 3, 4, 5, RETENTION_MAX_AGE_DAYS + 1)
    expect(selectExpired(candidates, NOW)).toEqual([`b-${RETENTION_MAX_AGE_DAYS + 1}`])
  })

  it("ちょうど期間の境界(90日)は残す", () => {
    expect(selectExpired(daysAgo(0, 1, 2, 3, 4, 5, RETENTION_MAX_AGE_DAYS), NOW)).toEqual([])
  })

  it("最新の数世代は、期間を超えていても必ず残す", () => {
    // 5世代すべてが100日以上前でも、削除されない
    const candidates = daysAgo(100, 101, 102, 103, 104)
    expect(candidates).toHaveLength(RETENTION_ALWAYS_KEEP)
    expect(selectExpired(candidates, NOW)).toEqual([])
    // 6世代目からは期間の判定が効く
    expect(selectExpired(daysAgo(100, 101, 102, 103, 104, 105), NOW)).toEqual(["b-105"])
  })

  it("件数の上限(30世代)を超えた分は、新しい順で後ろから削除する", () => {
    const candidates = Array.from({ length: RETENTION_MAX_COUNT + 3 }, (_, i) => ({
      name: `b-${i}`,
      timestampMs: NOW - i * 1000,
    }))
    expect(selectExpired(candidates, NOW)).toEqual(["b-30", "b-31", "b-32"])
  })

  it("入力の並び順に依存しない", () => {
    const shuffled = daysAgo(200, 0, 150, 1, 2, 3, 4, 5, 160)
    expect(selectExpired(shuffled, NOW).sort()).toEqual(["b-150", "b-160", "b-200"])
  })
})
