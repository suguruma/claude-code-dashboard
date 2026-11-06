import { ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { guardEstimateNote } from "@/lib/usageFormat"
import type { UsageGuard, UsageWindowView } from "@/lib/usageTypes"

/**
 * 上限ガードの帯。最新の公式値が80%以上(注意)・90%以上(強い注意)のとき、Claude Desktop の各ページ(一覧・組織図・利用上限)の上部に出す。
 * ガードの判断そのものは運用ルール側で行い、ダッシュボードは表示だけを行う。
 */
export function UsageGuardBand({ guard, windows }: { guard: UsageGuard | null | undefined; windows?: UsageWindowView[] }) {
  if (!guard || guard.level === "none" || guard.percent === null) return null
  const high = guard.level === "high"
  // 帯の有無と色は公式値で決める。ゲージ・カードの%(推定)と違うときは、その値も添える(⑧-2)
  const estimateNote = guardEstimateNote(guard, windows)
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        high
          ? "border-[var(--status-serious)] bg-[color-mix(in_oklab,var(--status-serious)_14%,transparent)]"
          : "border-[var(--status-warning)] bg-[color-mix(in_oklab,var(--status-warning)_14%,transparent)]"
      )}
    >
      <ShieldAlert
        className="mt-0.5 size-4 shrink-0"
        style={{ color: high ? "var(--status-serious)" : "var(--status-warning)" }}
        aria-hidden
      />
      {/* 数は上のバーの利用上限の札に出すので、帯は判断の語だけの1行にする(⑮ 中2。同じ数を3か所に出さない) */}
      <p className="font-medium" title={`${guard.windowLabel}の公式値 ${guard.percent}%${estimateNote ? `（${estimateNote}）` : ""}`}>
        {high ? "上限ガード中：新しい指示を控える" : "上限に近づいています：新しい指示を控える"}
      </p>
    </div>
  )
}
