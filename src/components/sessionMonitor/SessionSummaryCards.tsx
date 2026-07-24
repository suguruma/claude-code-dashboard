import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SessionMetrics } from "@/lib/types"

interface SessionSummaryCardsProps {
  metrics: SessionMetrics
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

function formatChars(chars: number): string {
  if (chars >= 10000) return `${(chars / 10000).toFixed(1)}万文字`
  return `${chars.toLocaleString()}文字`
}

export function SessionSummaryCards({ metrics }: SessionSummaryCardsProps) {
  const { summary } = metrics
  const totalTokens = summary.totalInputTokens + summary.totalOutputTokens
  const cacheTotal = summary.totalCacheReadTokens + summary.totalCacheCreationTokens
  const cacheHitRate = cacheTotal > 0 ? Math.round((summary.totalCacheReadTokens / cacheTotal) * 100) : null

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <StatCard label="ターン数" value={String(summary.turnCount)} />
      <StatCard label="ツール呼び出し" value={`${summary.toolCallCount}回`} />
      <StatCard label="ツールエラー" value={`${summary.toolErrorCount}回`} />
      <StatCard label="トークン合計(入出力)" value={totalTokens.toLocaleString()} />
      <StatCard label="キャッシュヒット率" value={cacheHitRate !== null ? `${cacheHitRate}%` : "—"} />
      <StatCard label="コンパクション" value={`${summary.compactionCount}回`} />
      <StatCard label="ユーザーメッセージ" value={`${metrics.userMessageCount}件`} />
      <StatCard label="割り込み" value={`${metrics.interruptedToolCallCount}回`} />
      <StatCard label="サブエージェント呼出" value={`${metrics.sidechainToolCallCount}回`} />
      <StatCard label="フック失敗" value={`${metrics.hookErrorCount}回`} />
      <StatCard label="MCP呼び出し" value={`${summary.mcpToolCallCount}回`} />
      <StatCard label="スキル呼び出し" value={`${summary.skillCallCount}回`} />
      <StatCard label="ツール出力合計" value={formatChars(summary.totalToolOutputChars)} />
    </div>
  )
}
