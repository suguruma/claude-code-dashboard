import { Archive, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatJst } from "@/lib/usageFormat"
import type { OrgFileStatus, OrgRuleFile, StaleRef } from "@/lib/orgRulesTypes"

/** ファイルを読めなかったときの文言(status ごと)。missing だけは、呼び出し側が場所に合った文言を渡す */
const STATUS_TEXT: Record<Exclude<OrgFileStatus, "ok" | "missing">, string> = {
  disabled:
    "自動で探すのを止めています（CCD_DESKTOP_AUTODETECT=0）。設定ファイル config/org-rules.json の globalClaudeMdPath か、環境変数 CCD_GLOBAL_CLAUDE_MD で場所を指定すると読みます。",
  wsl: "この PC からは読めません（WSL の作業フォルダ）。",
  refused: "認証情報などを含む可能性があるファイルのため、読みません。",
  unsupported: ".md と .txt のファイルだけを読みます。",
  "too-large": "1MB を超えるため、読みません。",
  unreadable: "読み込みに失敗しました。",
}

/** 古いセッション名の印の一覧。色だけでなく、アイコンと文字で区別する */
export function StaleRefList({ refs }: { refs: StaleRef[] }) {
  if (refs.length === 0) return null
  return (
    <ul className="space-y-1 text-xs" data-testid="stale-refs">
      {refs.map((r) => (
        <li key={`${r.kind}:${r.text}`} className="flex items-start gap-1.5">
          {r.kind === "mismatch" ? (
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" style={{ color: "var(--status-warning-text)" }} aria-hidden />
          ) : (
            <Archive className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span>
            <span className="font-medium" style={r.kind === "mismatch" ? { color: "var(--status-warning-text)" } : undefined}>
              {r.kind === "mismatch" ? "今の題名と合わない" : "アーカイブ済みのセッションの名前"}：
            </span>
            <code className="font-mono">{r.text}</code>
            {r.sameName.length > 0 && <span className="text-muted-foreground">（同じ名前の今の題名：{r.sameName.join("・")}）</span>}
            {r.sameNumber.length > 0 && <span className="text-muted-foreground">（同じ番号の今の題名：{r.sameNumber.join("・")}）</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * ルールのファイル1つ(グローバルの CLAUDE.md・作業フォルダの CLAUDE.md・追加のファイル)。
 * 節ごとに開閉でき、先頭に出す節(pinned)は開いた状態で出す。本文は書いてあるとおりの文字で出す(HTML として描画しない)
 */
export function RuleFileView({ file, missingText, testId }: { file: OrgRuleFile; missingText: string; testId?: string }) {
  if (file.status !== "ok") {
    return (
      <div className="space-y-1" data-testid={testId}>
        {file.path && <p className="font-mono text-xs break-all text-muted-foreground">{file.path}</p>}
        <p className="text-sm text-muted-foreground">{file.status === "missing" ? missingText : STATUS_TEXT[file.status]}</p>
      </div>
    )
  }
  return (
    <div className="space-y-2" data-testid={testId}>
      <p className="font-mono text-xs break-all text-muted-foreground">
        {file.path}
        {file.updatedAt !== null && <span className="ml-2 font-sans">（更新 {formatJst(file.updatedAt)}）</span>}
      </p>
      {file.preamble && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{file.preamble}</p>}
      {file.sections.length === 0 && <p className="text-sm text-muted-foreground">見出し（## ）の節がありません。</p>}
      <div className="space-y-2">
        {file.sections.map((section, i) => (
          <details
            key={`${i}:${section.title}`}
            open={section.pinned === true}
            className="rounded-lg border px-3 py-2"
            data-testid="rule-section"
          >
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium">
              <span>{section.title}</span>
              {section.pinned && <Badge variant="secondary">先頭に表示</Badge>}
              {!section.enabled && <Badge variant="outline">無効</Badge>}
              {section.staleRefs.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <TriangleAlert className="size-3" aria-hidden />
                  古い名前の疑い {section.staleRefs.length}件
                </Badge>
              )}
            </summary>
            <div className="mt-2 space-y-2">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{section.body || "（本文なし）"}</p>
              <StaleRefList refs={section.staleRefs} />
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
