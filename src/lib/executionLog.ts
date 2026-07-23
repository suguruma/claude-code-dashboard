import { readJsonFile, resolveProjectPath } from "./fileIO"
import { createRule } from "./rules"
import { ExecutionLogEntry, ExecutionLogFile, ProjectConfig } from "./types"

/**
 * execution_log.json は仕様書のサンプルでは単一オブジェクトだが、
 * タスクを重ねるたびに蓄積される時系列ログという性質上、本ダッシュボードでは
 * `{ logs: ExecutionLogEntry[] }` を正式スキーマとして扱う。
 * Claude Code 側が仕様書どおり単一オブジェクトのまま出力・上書きしてきた場合も
 * 後方互換として自動的に配列へラップして読み込む。
 */
export async function getExecutionLogs(project: ProjectConfig): Promise<ExecutionLogEntry[]> {
  const logPath = resolveProjectPath(project.path, "execution_log.json")
  const raw = await readJsonFile<unknown>(logPath, { logs: [] })

  if (Array.isArray(raw)) {
    return raw as ExecutionLogEntry[]
  }
  if (raw && typeof raw === "object") {
    if ("logs" in raw && Array.isArray((raw as ExecutionLogFile).logs)) {
      return (raw as ExecutionLogFile).logs
    }
    if ("task_id" in raw) {
      return [raw as ExecutionLogEntry]
    }
  }
  return []
}

export async function getExecutionLogByTaskId(
  project: ProjectConfig,
  taskId: string
): Promise<ExecutionLogEntry | null> {
  const logs = await getExecutionLogs(project)
  return logs.find((l) => l.task_id === taskId) ?? null
}

export async function saveSuggestedRulesFromLog(
  project: ProjectConfig,
  taskId: string
): Promise<number> {
  const entry = await getExecutionLogByTaskId(project, taskId)
  if (!entry) throw new Error("指定されたタスクログが見つかりません")
  for (const suggestion of entry.suggested_new_rules) {
    await createRule(project, {
      category: suggestion.category,
      content: suggestion.content,
      enabled: true,
    })
  }
  return entry.suggested_new_rules.length
}
