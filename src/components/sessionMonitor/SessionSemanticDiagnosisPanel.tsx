"use client"

import { useState } from "react"
import { ChevronRight, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { SessionSemanticDiagnosis, SessionSemanticFinding } from "@/lib/types"
import { STATUS_TOKENS, StatusBadge } from "./statusToken"

const INVOKE_COMMAND = "/session-diagnostician"

interface SessionSemanticDiagnosisPanelProps {
  diagnosis: SessionSemanticDiagnosis | null
  isLoading: boolean
  onRefresh: () => void
}

function FindingRow({ finding }: { finding: SessionSemanticFinding }) {
  const [expanded, setExpanded] = useState(false)
  const token = STATUS_TOKENS[finding.severity]

  return (
    <div className={cn("overflow-hidden rounded-md border", token.surfaceClass)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 p-3 text-left"
      >
        <span className={cn("h-8 w-1 shrink-0 rounded-full", token.railClass)} aria-hidden />
        <token.Icon className="size-4 shrink-0" style={{ color: token.color }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium">{finding.title}</span>
            <span className="text-xs text-muted-foreground">{token.label}</span>
          </span>
        </span>
        <ChevronRight
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
          aria-hidden
        />
      </button>
      {expanded && (
        <div className="space-y-2 border-t px-3 py-3 pl-6">
          <p className="text-sm leading-relaxed">{finding.observation}</p>
          {finding.action && (
            <div className="rounded-md border bg-background p-2.5">
              <p className="text-xs font-medium text-muted-foreground">次のアクション</p>
              <p className="mt-1 text-sm leading-relaxed">{finding.action}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * ダッシュボード自身はLLMを呼ばない方針のため、意味的な診断はClaude Code側のスキル
 * （session-diagnostician）が生成するsession_diagnosis.jsonを読むだけ。
 * rule-optimizer→/refactorと同じ「未実行なら実行コマンドを案内する」構成に合わせている。
 */
export function SessionSemanticDiagnosisPanel({
  diagnosis,
  isLoading,
  onRefresh,
}: SessionSemanticDiagnosisPanelProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(INVOKE_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("クリップボードへのコピーに失敗しました")
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-muted-foreground" aria-hidden />
          AI診断（session-diagnosticianスキル）
          {diagnosis && <StatusBadge severity={diagnosis.overall} />}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          再読み込み
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}

        {!isLoading && !diagnosis && (
          <Alert>
            <Sparkles className="size-4" />
            <AlertTitle>まだAI診断がありません</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                下のしきい値ベースの診断はCPUのみで判定した機械的なものです。会話内容を実際に読んだ
                意味的な診断（要求の誤解・手戻りの繰り返し等）が必要な場合は、Claude Codeのターミナルで
                対象プロジェクトを開き、以下のコマンドを実行してください。
              </p>
              <div className="flex items-center gap-2">
                <code className="rounded-md bg-muted px-3 py-1.5 text-sm">{INVOKE_COMMAND}</code>
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? "コピーしました" : "コピー"}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && diagnosis && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm leading-relaxed">{diagnosis.summary}</p>
              <p className="shrink-0 text-xs text-muted-foreground">
                生成日時：{new Date(diagnosis.generatedAt).toLocaleString("ja-JP")}
              </p>
            </div>
            {diagnosis.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">指摘事項はありません。</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {diagnosis.findings.map((f) => (
                  <FindingRow key={f.id} finding={f} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
