import { formatDistanceToNowStrict } from "date-fns"
import { ja } from "date-fns/locale"
import type { InstructionOrigin } from "@/lib/desktopSessionTypes"

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

export function formatAgo(ms: number | null): string {
  if (ms === null) return "—"
  return formatDistanceToNowStrict(new Date(ms), { addSuffix: true, locale: ja })
}

export function formatDateTime(ms: number | null): string {
  if (ms === null) return "—"
  return new Date(ms).toLocaleString("ja-JP", { hour12: false })
}

export const ORIGIN_LABEL: Record<InstructionOrigin, string> = {
  human: "人",
  peer: "他セッション",
  notification: "通知",
  scheduled: "定期実行",
  system: "システム",
}
