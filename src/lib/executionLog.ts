import { backupFile, readJsonFile, resolveProjectPath, writeJsonFile } from "./fileIO"
import { createRule } from "./rules"
import {
  AgentsDiscussion,
  ExecutionLogEntry,
  ExecutionLogFile,
  ProjectConfig,
  SuggestedNewRule,
  TradeOff,
  UserIntervention,
} from "./types"

/**
 * execution_log.json は仕様書のサンプルでは単一オブジェクトだが、
 * タスクを重ねるたびに蓄積される時系列ログという性質上、本ダッシュボードでは
 * `{ logs: ExecutionLogEntry[] }` を正式スキーマとして扱う。
 * Claude Code 側が仕様書どおり単一オブジェクトのまま出力・上書きしてきた場合も
 * 後方互換として自動的に配列へラップして読み込む。
 */
async function readRawExecutionLogs(project: ProjectConfig): Promise<unknown[]> {
  const logPath = resolveProjectPath(project.path, "execution_log.json")
  const raw = await readJsonFile<unknown>(logPath, { logs: [] })

  if (Array.isArray(raw)) {
    return raw
  }
  if (raw && typeof raw === "object") {
    if ("logs" in raw && Array.isArray((raw as ExecutionLogFile).logs)) {
      return (raw as ExecutionLogFile).logs
    }
    if ("task_id" in raw) {
      return [raw]
    }
  }
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * エントリの task_id。文字列はそのまま、数値は文字列に直す（手書きのログで数値の ID を付けたもの）。
 * 無い・空・オブジェクトなど、ほかは null（選択も削除もできないので、画面には出せない）。
 */
function taskIdOf(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  const id = raw.task_id
  if (typeof id === "string") return id === "" ? null : id
  if (typeof id === "number" && Number.isFinite(id)) return String(id)
  return null
}

function normalizeDiscussion(raw: Record<string, unknown>): AgentsDiscussion {
  const discussion: AgentsDiscussion = { ...(raw as unknown as AgentsDiscussion) }
  if (typeof raw.consensus_rate !== "number" || !Number.isFinite(raw.consensus_rate)) delete discussion.consensus_rate
  if (typeof raw.conflict_point !== "string") delete discussion.conflict_point
  discussion.trade_offs = Array.isArray(raw.trade_offs) ? (raw.trade_offs as TradeOff[]) : []
  // 次の3つは「無い」ことに意味がある（無ければ画面は該当の表示を省く）ので、配列でなければ取り除く
  if (!Array.isArray(raw.assigned_agents)) delete discussion.assigned_agents
  if (!Array.isArray(raw.trial_process)) delete discussion.trial_process
  if (!Array.isArray(raw.chain_of_command)) delete discussion.chain_of_command
  return discussion
}

/**
 * 画面に渡すために、実行ログの1件を整える。手書き・他のツールが書いたログでは、agents_discussion や
 * user_interventions・suggested_new_rules が欠けていることがあり、そのまま読むと画面が落ちる。
 * - agents_discussion が無い（オブジェクトでない）ときは、無いまま返す。0%や空の議論を作らない
 * - user_interventions・suggested_new_rules が配列でないときは、空の配列にする
 * - task_id が数値のときは、文字列に直す
 * - オブジェクトでない要素・task_id が無い（空・数値と文字列以外）要素は、選択も削除もできないので、画面に出さない（ファイルには残る）。null を返す
 * ファイルへは書き戻さない。書き戻す側（deleteExecutionLog）は、この関数を通さない元のエントリを使う。
 */
export function normalizeExecutionLogEntry(raw: unknown): ExecutionLogEntry | null {
  const taskId = taskIdOf(raw)
  if (!isRecord(raw) || taskId === null) return null
  const entry = { ...(raw as unknown as ExecutionLogEntry), task_id: taskId }
  if (isRecord(raw.agents_discussion)) entry.agents_discussion = normalizeDiscussion(raw.agents_discussion)
  else delete entry.agents_discussion
  entry.user_interventions = Array.isArray(raw.user_interventions) ? (raw.user_interventions as UserIntervention[]) : []
  entry.suggested_new_rules = Array.isArray(raw.suggested_new_rules) ? (raw.suggested_new_rules as SuggestedNewRule[]) : []
  return entry
}

/** 画面に渡す実行ログと、表示できずに除いた要素の数（task_id が無いなど。ファイルには残っている） */
export async function readExecutionLogs(project: ProjectConfig): Promise<{ logs: ExecutionLogEntry[]; skipped: number }> {
  const logs: ExecutionLogEntry[] = []
  let skipped = 0
  for (const raw of await readRawExecutionLogs(project)) {
    const entry = normalizeExecutionLogEntry(raw)
    if (entry) logs.push(entry)
    else skipped++
  }
  return { logs, skipped }
}

export async function getExecutionLogs(project: ProjectConfig): Promise<ExecutionLogEntry[]> {
  return (await readExecutionLogs(project)).logs
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
 * 書き換える前に、現在の execution_log.json を `execution_log.json.ccd-backup.<epoch>` として退避する
 * (「設定 & システム情報」の「バックアップ」から戻せる)。退避に失敗したときは削除しない。
 * 残りのエントリは、ファイルにあったままの内容で書き戻す（画面用の補正 normalizeExecutionLogEntry の結果は書き戻さない。
 * 補うと、削除のたびに他のエントリへ項目が書き加わる）。
 */
export async function deleteExecutionLog(project: ProjectConfig, taskId: string): Promise<void> {
  const logs = await readRawExecutionLogs(project)
  const isTarget = (l: unknown) => taskIdOf(l) === taskId
  if (!logs.some(isTarget)) {
    throw new Error("指定されたタスクログが見つかりません")
  }
  const remaining = logs.filter((l) => !isTarget(l))
  const logPath = resolveProjectPath(project.path, "execution_log.json")
  await backupFile(logPath)
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
