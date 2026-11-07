import type { UsageContributionSet, UsageResponse } from "./usageTypes"

/**
 * LAN(スマホ)へ返す利用上限の応答から、⑯ で足したセッションごとの内訳(`models`・`subagents`)を外す。
 * ⑯ AG-7「LAN には出さない(PC だけ)」。スマホの画面は使っていないので、表示は変わらない
 */
export function usageForLan(res: UsageResponse): UsageResponse {
  const strip = (set: UsageContributionSet): UsageContributionSet => ({
    ...set,
    items: set.items.map((item) => {
      const rest = { ...item }
      delete rest.models
      delete rest.subagents
      return rest
    }),
  })
  return { ...res, contributions: { fiveHour: strip(res.contributions.fiveHour), week: strip(res.contributions.week) } }
}
