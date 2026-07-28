import { readJsonFile, resolveProjectPath } from "./fileIO"
import { SessionSemanticDiagnosis, SessionSemanticFinding } from "./types"

const DIAGNOSIS_FILE_NAME = "session_diagnosis.json"
const SEVERITIES = new Set(["good", "warning", "critical", "info"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isSeverity(value: unknown): value is SessionSemanticFinding["severity"] {
  return typeof value === "string" && SEVERITIES.has(value)
}

/**
 * `session-diagnostician`スキルが対象セッションのcwd直下に生成する`session_diagnosis.json`を読む。
 * ファイルが無い（スキル未実行）・壊れている・sessionIdが一致しない（別セッション向けの古い診断が
 * 残っている）場合はnullを返す（rule_refactor_proposal.jsonと同じ「無ければ静かにnull」の方針）。
 */
export async function readSessionSemanticDiagnosis(
  cwd: string | null,
  sessionId: string
): Promise<SessionSemanticDiagnosis | null> {
  if (!cwd) return null
  const filePath = resolveProjectPath(cwd, DIAGNOSIS_FILE_NAME)
  const raw = await readJsonFile<unknown>(filePath, null)
  if (!isRecord(raw)) return null
  if (raw.sessionId !== sessionId) return null
  if (typeof raw.summary !== "string") return null
  if (!isSeverity(raw.overall)) return null
  if (!Array.isArray(raw.findings)) return null

  const findings: SessionSemanticFinding[] = []
  for (const f of raw.findings) {
    if (!isRecord(f)) continue
    if (typeof f.id !== "string" || typeof f.title !== "string") continue
    if (!isSeverity(f.severity)) continue
    if (typeof f.observation !== "string") continue
    if (f.action !== null && typeof f.action !== "string") continue
    findings.push({
      id: f.id,
      title: f.title,
      severity: f.severity,
      observation: f.observation,
      action: (f.action as string | null) ?? null,
    })
  }

  return {
    version: 1,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : new Date(0).toISOString(),
    sessionId,
    summary: raw.summary,
    overall: raw.overall,
    findings,
  }
}
