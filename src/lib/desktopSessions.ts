import { promises as fs } from "fs"
import os from "os"
import path from "path"

/**
 * Claude Desktop の内部形式を読む処理は、すべてこのファイルに閉じ込める。
 * Desktop の形式は公開仕様ではなく更新で変わりうるため、形式が変わったときに直す場所をここだけにする。
 *
 * 守る制約(検討書 7.2):
 * - S1: データフォルダの `config.json`(OAuthトークン)は開かない。名前を指定して読むのは下記3種のファイルだけ。
 * - S2: `claude_desktop_config.json` から取り出すのは `preferences.epitaxyPrefs` のグループ・割り当て・ピン留めだけ。
 *       同じファイルの `mcpServers`(環境変数にAPIキーが入りうる)は保持せず、エラー文にも内容を含めない。
 * - S3: メタデータは明示的に選んだ項目だけを `DesktopMeta` に写す(許可リスト方式)。
 * - S4: JSONの解析に失敗したら前回の値を使う。エラー文にファイルの内容を含めない。
 * - S5: 読み取り専用。このファイルには書き込み系の呼び出しが無い。
 */

export interface DesktopMeta {
  /** `local_<uuid>` */
  id: string
  cliSessionId: string | null
  title: string
  cwd: string | null
  model: string | null
  effort: string | null
  permissionMode: string | null
  isArchived: boolean
  isRoutine: boolean
  createdAt: number | null
  lastActivityAt: number | null
  completedTurns: number | null
  /** Desktopがターン終了後に付ける分類 */
  statusCategory: "blocked" | "review_ready" | "completed" | null
  /** 要対応の説明文が記録されているか(文そのものは保持しない) */
  needsAction: boolean
  /** ターン後の要約が対応している assistant の uuid */
  summaryFor: string | null
  lastAssistantUuid: string | null
  /** Desktopがエラーを記録しているか(内容は保持しない) */
  hasError: boolean
  /** エラーを記録した時刻。回復後もエラーの記録が残るため、その後に活動があったかの判断に使う */
  errorAt: number | null
}

export interface DesktopGroup {
  id: string
  name: string
  order: number
}

export interface SidebarPrefs {
  groups: Map<string, DesktopGroup>
  /** セッションID → グループID */
  assignments: Map<string, string>
  pinned: Set<string>
}

// ---------------------------------------------------------------------------
// データフォルダの場所

const SESSIONS_DIR_NAME = "claude-code-sessions"

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function listCandidateDataDirs(): Promise<string[]> {
  const candidates: string[] = []
  const home = os.homedir()
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local")
    const roaming = process.env.APPDATA ?? path.join(home, "AppData", "Roaming")
    // Microsoft Store版: %LOCALAPPDATA%\Claude-Data\<パッケージID>
    const storeRoot = path.join(local, "Claude-Data")
    try {
      for (const entry of await fs.readdir(storeRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(path.join(storeRoot, entry.name))
      }
    } catch {
      // ストア版のフォルダが無い
    }
    // 通常のインストーラー版(場所は未確認のため候補として探す)
    candidates.push(path.join(roaming, "Claude"), path.join(local, "Claude"))
  } else if (process.platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "Claude"))
  } else {
    candidates.push(path.join(home, ".config", "Claude"))
  }
  return candidates
}

/**
 * Desktop のデータフォルダ(`claude-code-sessions` を含むフォルダ)を探す。
 * 明示指定(設定・環境変数)があればそれを使い、無ければ候補のうち最も新しく更新されたものを選ぶ。
 */
export async function resolveDesktopDataDir(explicit?: string | null): Promise<string | null> {
  const override = explicit?.trim() || process.env.CLAUDE_DESKTOP_DATA_DIR?.trim()
  if (override) {
    return (await isDir(path.join(override, SESSIONS_DIR_NAME))) ? override : null
  }

  let best: { dir: string; mtimeMs: number } | null = null
  for (const dir of await listCandidateDataDirs()) {
    try {
      const stat = await fs.stat(path.join(dir, SESSIONS_DIR_NAME))
      if (stat.isDirectory() && (!best || stat.mtimeMs > best.mtimeMs)) best = { dir, mtimeMs: stat.mtimeMs }
    } catch {
      // このフォルダにはセッションが無い
    }
  }
  return best?.dir ?? null
}

// ---------------------------------------------------------------------------
// メタデータ(local_*.json)

const META_FILE = /^local_[A-Za-z0-9_-]+\.json$/
const MAX_SCAN_DEPTH = 3

export interface MetaFileRef {
  filePath: string
  mtimeMs: number
  size: number
}

/** `claude-code-sessions/<アカウント>/<組織>/local_*.json` を列挙する(階層は多少変わっても拾えるよう深さ3まで) */
export async function listMetaFiles(dataDir: string): Promise<MetaFileRef[]> {
  const result: MetaFileRef[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (depth < MAX_SCAN_DEPTH) await walk(full, depth + 1)
        } else if (entry.isFile() && META_FILE.test(entry.name)) {
          try {
            const stat = await fs.stat(full)
            result.push({ filePath: full, mtimeMs: stat.mtimeMs, size: stat.size })
          } catch {
            // 列挙後に削除された
          }
        }
      })
    )
  }
  await walk(path.join(dataDir, SESSIONS_DIR_NAME), 1)
  return result
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

/**
 * 生のメタデータから、表示に必要な項目だけを選んで写す(許可リスト方式、S3)。
 * ここで選ばなかった項目(ツール一覧・システムプロンプトの写し・MCP設定・権限の更新履歴など)は、
 * 戻り値のどこにも残らない。
 */
export function projectMeta(raw: unknown): DesktopMeta | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const id = str(r.sessionId)
  if (!id) return null

  const summary = r.postTurnSummary && typeof r.postTurnSummary === "object" ? (r.postTurnSummary as Record<string, unknown>) : null
  const category = summary?.status_category
  const statusCategory =
    category === "blocked" || category === "review_ready" || category === "completed" ? category : null
  const needsActionText = summary?.needs_action

  return {
    id,
    cliSessionId: str(r.cliSessionId),
    title: str(r.title) ?? "",
    cwd: str(r.cwd),
    model: str(r.model),
    effort: str(r.effort),
    permissionMode: str(r.permissionMode),
    isArchived: r.isArchived === true,
    isRoutine: str(r.scheduledTaskId) !== null,
    createdAt: num(r.createdAt),
    lastActivityAt: num(r.lastActivityAt),
    completedTurns: num(r.completedTurns),
    statusCategory,
    needsAction: typeof needsActionText === "string" && needsActionText.trim().length > 0,
    summaryFor: str(r.postTurnSummaryFor) ?? str(summary?.summarizes_uuid),
    lastAssistantUuid: str(r.lastAssistantUuid),
    hasError: typeof r.error === "string" ? r.error.length > 0 : r.error != null && r.error !== false,
    errorAt: num(r.errorAt),
  }
}

interface CachedMeta {
  mtimeMs: number
  size: number
  meta: DesktopMeta
}

export interface MetaReadResult {
  metas: DesktopMeta[]
  /** 解析に失敗し、前回の値(または無し)で代用したファイルの数 */
  failedCount: number
}

/** 更新時刻とサイズが変わったファイルだけを読み直すキャッシュ(約40件×約560KBを毎回読み直さないため) */
export class MetaCache {
  private cache = new Map<string, CachedMeta>()

  async read(dataDir: string): Promise<MetaReadResult> {
    const files = await listMetaFiles(dataDir)
    const live = new Set(files.map((f) => f.filePath))
    for (const key of this.cache.keys()) {
      if (!live.has(key)) this.cache.delete(key)
    }

    let failedCount = 0
    const stale = files.filter((f) => {
      const cached = this.cache.get(f.filePath)
      return !cached || cached.mtimeMs !== f.mtimeMs || cached.size !== f.size
    })
    await mapLimit(stale, 6, async (file) => {
      try {
        const meta = projectMeta(JSON.parse(await fs.readFile(file.filePath, "utf-8")))
        if (meta) {
          this.cache.set(file.filePath, { mtimeMs: file.mtimeMs, size: file.size, meta })
          return
        }
        failedCount++
      } catch {
        // アプリが書き直している途中などで解析できない。前回の値を使い、次の取得で読み直す(S4)。
        // 更新時刻は記録し直さないので、次回も読み直しの対象になる。エラー文は捨てる(内容を含みうるため)
        failedCount++
      }
    })

    const metas: DesktopMeta[] = []
    for (const f of files) {
      const cached = this.cache.get(f.filePath)
      if (cached) metas.push(cached.meta)
    }
    return { metas, failedCount }
  }
}

/** 同時に実行する数を制限して、全要素に非同期処理を適用する */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

// ---------------------------------------------------------------------------
// サイドバー(グループ・ピン留め)

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  return null
}

function stripCodePrefix(id: string): string {
  return id.startsWith("code:") ? id.slice("code:".length) : id
}

const GROUP_NAME_MAX = 40

/**
 * `preferences.epitaxyPrefs` から、グループ・割り当て・ピン留めだけを取り出す(S2)。
 * 引数の大きなオブジェクトは、この関数が返ったあと参照されなくなる。戻り値には必要な項目だけを新しく作って入れる。
 */
export function extractSidebarPrefs(epitaxyPrefs: unknown): SidebarPrefs {
  const result: SidebarPrefs = { groups: new Map(), assignments: new Map(), pinned: new Set() }
  const prefs = asObject(epitaxyPrefs)
  if (!prefs) return result

  const sectionsByScope = asObject(prefs["dframe-code-sections"])
  if (sectionsByScope) {
    for (const scope of Object.values(sectionsByScope)) {
      const sections = asObject(scope)?.sections
      if (!Array.isArray(sections)) continue
      for (const section of sections) {
        const s = asObject(section)
        if (!s || s.kind !== "manual") continue
        const id = str(s.id)
        const name = str(s.name)
        if (!id || !name) continue
        result.groups.set(id, { id, name: name.slice(0, GROUP_NAME_MAX), order: num(s.order) ?? Number.MAX_SAFE_INTEGER })
      }
    }
  }

  const scopes = asObject(prefs["dframe-group-scopes"])
  if (scopes) {
    for (const scope of Object.values(scopes)) {
      const s = asObject(scope)
      if (!s) continue
      // groups[] は一部のグループしか含まないことがあるため、sections に無い名前だけを補う
      if (Array.isArray(s.groups)) {
        for (const group of s.groups) {
          const g = asObject(group)
          const id = str(g?.id)
          const name = str(g?.name)
          if (id && name && !result.groups.has(id)) {
            result.groups.set(id, { id, name: name.slice(0, GROUP_NAME_MAX), order: Number.MAX_SAFE_INTEGER })
          }
        }
      }
      const assignments = asObject(s.assignments)
      if (assignments) {
        for (const [key, groupId] of Object.entries(assignments)) {
          if (typeof groupId === "string") result.assignments.set(stripCodePrefix(key), groupId)
        }
      }
    }
  }

  // ピン留めの判定は starred-local-code-sessions だけ。dframe-local-slice.pinnedOrder は並び順のための情報で、
  // ピン留めの有無を表さない(読まない)
  const starred = prefs["starred-local-code-sessions"]
  if (Array.isArray(starred)) {
    for (const id of starred) if (typeof id === "string") result.pinned.add(stripCodePrefix(id))
  }
  return result
}

/**
 * `claude_desktop_config.json` を読み、サイドバーの設定だけを返す。読めなければ null。
 * ファイルの内容・解析エラーの文面は、戻り値にもログにも出さない(S2・S4)。
 */
export async function readSidebarPrefs(dataDir: string): Promise<SidebarPrefs | null> {
  let parsed: { preferences?: { epitaxyPrefs?: unknown } } | null
  try {
    parsed = JSON.parse(await fs.readFile(path.join(dataDir, "claude_desktop_config.json"), "utf-8"))
  } catch {
    return null
  }
  const result = extractSidebarPrefs(parsed?.preferences?.epitaxyPrefs)
  parsed = null // mcpServers 等を含む元のオブジェクトをすぐ手放す
  return result
}

// ---------------------------------------------------------------------------
// 会話ログの所在

export interface TranscriptRef {
  filePath: string
  /** `~/.claude/projects/` 直下のフォルダ名 */
  dirName: string
  /** 拡張子を除いたファイル名(= cliSessionId) */
  sessionId: string
}

/**
 * `<projectsRoot>/*\/<cliSessionId>.jsonl` の一覧を作る。
 * フォルダ名は作業フォルダから計算できない(日本語が置き換わる・SSHは別名)ため、計算せずに全フォルダから探す。
 */
export async function indexTranscripts(projectsRoot: string): Promise<Map<string, TranscriptRef>> {
  const index = new Map<string, TranscriptRef>()
  let dirents
  try {
    dirents = await fs.readdir(projectsRoot, { withFileTypes: true })
  } catch {
    return index
  }
  await Promise.all(
    dirents
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const dir = path.join(projectsRoot, d.name)
        let files: string[]
        try {
          files = await fs.readdir(dir)
        } catch {
          return
        }
        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue
          const sessionId = file.slice(0, -".jsonl".length)
          index.set(sessionId, { filePath: path.join(dir, file), dirName: d.name, sessionId })
        }
      })
  )
  return index
}
