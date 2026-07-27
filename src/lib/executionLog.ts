import { readJsonFile, resolveProjectPath, writeJsonFile } from "./fileIO"
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

/**
 * 指定したtask_idのログエントリのみを削除し、残りのエントリで execution_log.json を上書きする。
 * 読み込み側の後方互換（単一オブジェクト/配列直下）に関わらず、書き込みは常に正式スキーマ
 * `{ logs: ExecutionLogEntry[] }` に統一する。
 */
export async function deleteExecutionLog(project: ProjectConfig, taskId: string): Promise<void> {
  const logs = await getExecutionLogs(project)
  if (!logs.some((l) => l.task_id === taskId)) {
    throw new Error("指定されたタスクログが見つかりません")
  }
  const remaining = logs.filter((l) => l.task_id !== taskId)
  const logPath = resolveProjectPath(project.path, "execution_log.json")
  await writeJsonFile(logPath, { logs: remaining })
}

/**
 * execution_log.jsonは「分析対象」（スキルが実際に実行された作業ディレクトリ）から読み込む一方、
 * suggested_new_rulesの反映先は「設定管理で選択中」のプロジェクト（通常は~/.claude）にしたいという
 * ケースがあるため、読み込み元(sourceProject)と書き込み先(targetProject)を分離する。
 * 分離不要な場合（同一プロジェクトで完結させたい場合）は同じProjectConfigを渡せばよい。
 */
export async function saveSuggestedRulesFromLog(
  sourceProject: ProjectConfig,
  targetProject: ProjectConfig,
  taskId: string
): Promise<number> {
  const entry = await getExecutionLogByTaskId(sourceProject, taskId)
  if (!entry) throw new Error("指定されたタスクログが見つかりません")
  for (const suggestion of entry.suggested_new_rules) {
    await createRule(targetProject, {
      category: suggestion.category,
      content: suggestion.content,
      enabled: true,
    })
  }
  return entry.suggested_new_rules.length
}
