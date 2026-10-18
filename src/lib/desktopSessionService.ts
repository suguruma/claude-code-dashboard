import { promises as fs, type Stats } from "fs"
import path from "path"
import { getAppDataRoot } from "./fileIO"
import { CONTEXT_LIMIT_NOTE, resolveContextLimit, type ContextLimitOverrides } from "./desktopContextLimits"
import {
  DEFAULT_THRESHOLDS,
  inferStatus,
  type StatusThresholds,
} from "./desktopSessionStatus"
import type {
  DesktopSessionCounts,
  DesktopSessionDetail,
  DesktopSessionGroup,
  DesktopSessionListResponse,
  DesktopSessionStatus,
  DesktopSessionSummary,
  DesktopSessionTask,
} from "./desktopSessionTypes"
import {
  MetaCache,
  indexTranscripts,
  mapLimit,
  readSidebarPrefs,
  resolveDesktopDataDir,
  type DesktopMeta,
  type SidebarPrefs,
  type TranscriptRef,
} from "./desktopSessions"
import { CliProcessWatcher, type CliProcessSource } from "./cliProcesses"
import { DEFAULT_HOUSEKEEPING_THRESHOLDS, type HousekeepingThresholds } from "./housekeepingTypes"
import type { SessionIdentity } from "./usageEstimate"
import { getClaudeProjectsRoot } from "./sessionMonitor"
import {
  INSTRUCTION_EXCERPT_CHARS,
  advanceDigest,
  createDigest,
  makeExcerpt,
  messagingOf,
  readTailDigest,
  type TranscriptDigest,
} from "./transcriptDigest"

export interface DesktopSessionServiceOptions {
  /** Desktopのデータフォルダ。省略時は自動検出 */
  dataDir?: string | null
  /** 会話ログのルート。省略時は `~/.claude/projects` */
  projectsRoot?: string
  now?: () => number
  thresholds?: StatusThresholds
  contextLimits?: ContextLimitOverrides
  /** この比率以上を「コンテキスト使用率が高い」とする */
  highContextRatio?: number
  /** 暫定の要約のために読む末尾のバイト数(テスト用) */
  tailBytes?: number
  /** 会話ログだけの縮退表示で並べる最大件数 */
  fallbackLimit?: number
  /** 起動中のCLIプロセスの確認(段階2)。省略時は確認せず、画面には「情報なし」として扱う */
  cliProcesses?: CliProcessSource
  /** 組織図で、グループの指揮役を見つけるタイトルの接頭辞。省略時は DEFAULT_ORCHESTRATOR_PREFIX */
  orchestratorPrefix?: string
  /** 整理ページ(⑦)の判定のしきい値。省略した項目は DEFAULT_HOUSEKEEPING_THRESHOLDS */
  housekeeping?: Partial<HousekeepingThresholds>
}

/** 指揮役のタイトルの既定の接頭辞(設定ファイルの `orchestratorPrefix` で変えられる) */
export const DEFAULT_ORCHESTRATOR_PREFIX = "00_"

/** 組織図(⑤)が、グループの会話ログを読むために使う、グループ内のセッション */
export interface GroupSource {
  summary: DesktopSessionSummary
  /** 会話ログのファイル。見つからなければ null */
  filePath: string | null
}

const DATA_DIR_TTL_MS = 30_000
const TRANSCRIPT_INDEX_TTL_MS = 4_000
const FALLBACK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const STEP_EXCERPT_CHARS = 60

interface DigestEntry {
  size: number
  mtimeMs: number
  tail: TranscriptDigest | null
  tailSize: number
  full: TranscriptDigest | null
  scanning: Promise<void> | null
}

interface BuiltSession {
  summary: DesktopSessionSummary
  tasks: DesktopSessionTask[]
  ref: TranscriptRef | null
  lastCompactionAt: number | null
}

const STATUS_RANK: Record<DesktopSessionStatus, number> = {
  blocked: 0,
  running: 1,
  interrupted: 2,
  error: 2,
  review_ready: 3,
  waiting: 3,
  completed: 3,
  unknown: 3,
}

function baseName(p: string | null): string | null {
  if (!p) return null
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? null
}

/**
 * Desktopのセッション一覧を組み立てる。メタデータ・サイドバー設定・会話ログの要約を更新時刻でキャッシュし、
 * 5秒ごとの再取得でも、変わったファイルだけを読み直す。
 */
export class DesktopSessionService {
  private readonly opts: DesktopSessionServiceOptions
  private readonly metaCache = new MetaCache()
  private readonly digests = new Map<string, DigestEntry>()
  private readonly pending = new Set<Promise<void>>()
  private scanChain: Promise<void> = Promise.resolve()

  private dataDirCache: { at: number; dir: string | null } | null = null
  private transcriptIndex: { at: number; map: Map<string, TranscriptRef> } | null = null
  private prefsCache: { mtimeMs: number; size: number; prefs: SidebarPrefs } | null = null
  private lastPrefs: SidebarPrefs | null = null
  private built = new Map<string, BuiltSession>()
  /** この一覧の組み立てで使う、起動中のCLIが開いているセッションIDの集合(取得できていなければ null) */
  private cliIds: Set<string> | null = null

  constructor(options: DesktopSessionServiceOptions = {}) {
    this.opts = options
  }

  private now(): number {
    return (this.opts.now ?? Date.now)()
  }

  /** 実行中のバックグラウンド解析がすべて終わるまで待つ(テスト用) */
  async settle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending])
    }
  }

  private async getDataDir(): Promise<string | null> {
    const now = this.now()
    if (this.dataDirCache && now - this.dataDirCache.at < DATA_DIR_TTL_MS) return this.dataDirCache.dir
    const dir = await resolveDesktopDataDir(this.opts.dataDir)
    this.dataDirCache = { at: now, dir }
    return dir
  }

  private async getTranscripts(): Promise<Map<string, TranscriptRef>> {
    const now = this.now()
    if (this.transcriptIndex && now - this.transcriptIndex.at < TRANSCRIPT_INDEX_TTL_MS) {
      return this.transcriptIndex.map
    }
    const map = await indexTranscripts(this.opts.projectsRoot ?? getClaudeProjectsRoot())
    this.transcriptIndex = { at: now, map }
    return map
  }

  private async getPrefs(dataDir: string): Promise<{ prefs: SidebarPrefs | null; failed: boolean }> {
    const file = path.join(dataDir, "claude_desktop_config.json")
    let stat: Stats
    try {
      stat = await fs.stat(file)
    } catch {
      return { prefs: null, failed: false }
    }
    if (this.prefsCache && this.prefsCache.mtimeMs === stat.mtimeMs && this.prefsCache.size === stat.size) {
      return { prefs: this.prefsCache.prefs, failed: false }
    }
    const prefs = await readSidebarPrefs(dataDir)
    // 読めなかったときは前回の値を使い、更新時刻は覚えない(次の取得で読み直す)(S4)
    if (prefs) {
      this.prefsCache = { mtimeMs: stat.mtimeMs, size: stat.size, prefs }
      this.lastPrefs = prefs
      return { prefs, failed: false }
    }
    this.prefsCache = null
    return { prefs: this.lastPrefs, failed: true }
  }

  /** 会話ログの要約を返す。末尾だけの暫定値で先に返し、全体の解析はバックグラウンドで進める */
  private async digestFor(ref: TranscriptRef): Promise<{ digest: TranscriptDigest | null; mtimeMs: number | null }> {
    let stat: Stats
    try {
      stat = await fs.stat(ref.filePath)
    } catch {
      this.digests.delete(ref.filePath)
      return { digest: null, mtimeMs: null }
    }

    let entry = this.digests.get(ref.filePath)
    // サイズが減っていたら、書き直されたとみなして最初から読み直す
    if (!entry || stat.size < entry.size) {
      entry = { size: stat.size, mtimeMs: stat.mtimeMs, tail: null, tailSize: -1, full: null, scanning: null }
      this.digests.set(ref.filePath, entry)
    }
    entry.size = stat.size
    entry.mtimeMs = stat.mtimeMs

    if (entry.full) {
      if (stat.size > entry.full.offset) {
        // 追記された分だけを読み足す。同時に複数の取得が来ても、読み足しは1回だけにする
        if (!entry.scanning) {
          const target = entry
          target.scanning = this.track(
            advanceDigest(ref.filePath, entry.full, stat.size)
              .catch(() => undefined)
              .finally(() => {
                target.scanning = null
              })
          )
        }
        await entry.scanning
      }
      return { digest: entry.full, mtimeMs: stat.mtimeMs }
    }

    if (!entry.tail || entry.tailSize !== stat.size) {
      entry.tail = await readTailDigest(ref.filePath, stat.size, this.opts.tailBytes)
      entry.tailSize = stat.size
    }
    if (!entry.scanning) entry.scanning = this.scheduleFullScan(ref.filePath, entry)
    return { digest: entry.tail, mtimeMs: stat.mtimeMs }
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    const wrapped = promise.then(
      () => undefined,
      () => undefined
    )
    this.pending.add(wrapped)
    void wrapped.finally(() => this.pending.delete(wrapped))
    return promise
  }

  /** 全体の解析は1ファイルずつ順に行い、一覧の応答や他の処理を圧迫しない */
  private scheduleFullScan(filePath: string, entry: DigestEntry): Promise<void> {
    const job = this.scanChain.then(async () => {
      try {
        const fresh = createDigest()
        const target = entry.size
        await advanceDigest(filePath, fresh, target)
        // 解析中に追記された分は、次の取得で差分として読み足す
        if (this.digests.get(filePath) === entry) entry.full = fresh
      } catch {
        // 読み取りに失敗した。次の取得で再試行する(内容を含むエラー文は残さない)
      } finally {
        entry.scanning = null
      }
    })
    this.scanChain = job
    return this.track(job)
  }

  async list(): Promise<DesktopSessionListResponse> {
    const now = this.now()
    const warnings: string[] = []
    const highContextRatio = this.opts.highContextRatio ?? 0.8
    const dataDir = await this.getDataDir()
    // 手元の結果を即座に受け取るだけで、プロセスの確認(約1秒)の完了は待たない
    this.cliIds = this.opts.cliProcesses?.peek() ?? null

    let metas: DesktopMeta[] = []
    let prefs: SidebarPrefs | null = null
    if (dataDir) {
      const read = await this.metaCache.read(dataDir)
      metas = read.metas
      if (read.failedCount > 0) {
        warnings.push(
          `${read.failedCount}件のセッション情報を解釈できませんでした。前回の値で表示するか、一覧から除いています。Desktopの更新で形式が変わった可能性があります。`
        )
      }
      const prefsResult = await this.getPrefs(dataDir)
      prefs = prefsResult.prefs
      if (prefsResult.failed) warnings.push("サイドバーのグループ情報を読み取れませんでした。グループとピン留めは前回の値(無ければ非表示)です。")
    }

    const transcripts = await this.getTranscripts()
    const built: BuiltSession[] = []
    let source: DesktopSessionListResponse["source"]

    if (metas.length > 0) {
      source = "desktop"
      await mapLimit(metas, 8, async (meta) => {
        const ref = meta.cliSessionId ? (transcripts.get(meta.cliSessionId) ?? null) : null
        const res = ref ? await this.digestFor(ref) : { digest: null, mtimeMs: null }
        built.push(this.build(meta, ref, res.digest, res.mtimeMs, prefs, now))
      })
    } else {
      // Desktopのメタデータが無い・読めない: 会話ログだけで一覧を作る(状態は更新状況からの推定のみ)
      source = transcripts.size > 0 ? "transcript-only" : "none"
      if (source === "transcript-only") {
        warnings.unshift(
          dataDir
            ? "Desktopのセッション情報を読めないため、会話ログだけの縮退表示です。要対応・確認待ち・完了の分類、グループ、ピン留めは表示できません。"
            : "Claude Desktopのデータフォルダが見つからないため、会話ログだけの縮退表示です。要対応・確認待ち・完了の分類、グループ、ピン留めは表示できません。"
        )
        const stats = await Promise.all(
          [...transcripts.values()].map(async (ref) => {
            try {
              return { ref, mtimeMs: (await fs.stat(ref.filePath)).mtimeMs }
            } catch {
              return null
            }
          })
        )
        const recent = stats
          .filter((s): s is { ref: TranscriptRef; mtimeMs: number } => s !== null && now - s.mtimeMs <= FALLBACK_MAX_AGE_MS)
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .slice(0, this.opts.fallbackLimit ?? 60)
        await mapLimit(recent, 8, async ({ ref }) => {
          const res = await this.digestFor(ref)
          built.push(this.build(null, ref, res.digest, res.mtimeMs, null, now))
        })
      } else {
        warnings.unshift("Claude Desktopのデータフォルダも、会話ログ(~/.claude/projects)も見つかりませんでした。")
      }
    }

    this.built = new Map(built.map((b) => [b.summary.id, b]))
    const sessions = built.map((b) => b.summary)
    sessions.sort((a, b) => {
      const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
      if (rank !== 0) return rank
      return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
    })

    const missing = sessions.filter((s) => s.transcript === "missing" && !s.isArchived).length
    if (source === "desktop" && missing > 0) {
      warnings.push(`${missing}件のセッションは会話ログが見つかりません。コンテキスト・フェーズ・指示は表示できません。`)
    }
    const partial = sessions.filter((s) => s.digest === "partial").length
    if (partial > 0) {
      warnings.push(`${partial}件の会話ログを全体解析中です。圧縮の回数とフェーズは解析後に表示されます。`)
    }

    return {
      generatedAt: now,
      source,
      warnings,
      counts: this.countSessions(sessions, highContextRatio),
      groups: this.collectGroups(sessions, prefs),
      sessions,
      contextLimitNote: CONTEXT_LIMIT_NOTE,
      highContextRatio,
    }
  }

  /** 組織図の指揮役を見つけるタイトルの接頭辞 */
  orchestratorPrefix(): string {
    return this.opts.orchestratorPrefix ?? DEFAULT_ORCHESTRATOR_PREFIX
  }

  /** 整理ページ(⑦)の判定のしきい値(設定ファイルの `housekeeping` で上書きした値) */
  housekeepingThresholds(): HousekeepingThresholds {
    return { ...DEFAULT_HOUSEKEEPING_THRESHOLDS, ...this.opts.housekeeping }
  }

  /** コンテキストの上限(一覧と同じ、モデルごとの仮置き値。使用量が上限を超えていれば引き上げる) */
  contextLimitOf(model: string | null, tokens: number): number {
    return resolveContextLimit(model, tokens, this.opts.contextLimits)
  }

  /**
   * グループ内の、アーカイブされていないセッションと会話ログの所在(作成日時の古い順)。グループが無ければ group は null。
   * outsiders は、組織図の3層目の候補: どのグループにも入っていない、アーカイブされていない、親(spawnedFromId)を持つセッション。
   * 一覧と同じ要約キャッシュを使うので、呼び出しのたびに読み直すのは変わったファイルだけ。
   */
  async groupSources(
    groupId: string
  ): Promise<{ group: { id: string; name: string } | null; sources: GroupSource[]; outsiders: GroupSource[] }> {
    const list = await this.list()
    const group = list.groups.find((g) => g.id === groupId)
    const sources: GroupSource[] = []
    const outsiders: GroupSource[] = []
    for (const b of this.built.values()) {
      if (b.summary.isArchived) continue
      const source = { summary: b.summary, filePath: b.ref?.filePath ?? null }
      if (b.summary.group?.id === groupId) sources.push(source)
      else if (b.summary.group === null && b.summary.spawnedFromId !== null) outsiders.push(source)
    }
    const oldestFirst = (a: GroupSource, b: GroupSource) => {
      const ta = a.summary.createdAt ?? Number.POSITIVE_INFINITY
      const tb = b.summary.createdAt ?? Number.POSITIVE_INFINITY
      if (ta !== tb) return ta < tb ? -1 : 1
      return a.summary.id < b.summary.id ? -1 : 1
    }
    sources.sort(oldestFirst)
    outsiders.sort(oldestFirst)
    const name = group?.name ?? sources[0]?.summary.group?.name
    return { group: name !== undefined ? { id: groupId, name } : null, sources, outsiders }
  }

  async detail(id: string): Promise<DesktopSessionDetail | null> {
    // 一覧と同じ要約キャッシュを使うので、毎回組み立て直しても読み直すのは変わったファイルだけ
    await this.list()
    const entry = this.built.get(id)
    if (!entry) return null
    return {
      ...entry.summary,
      tasks: entry.tasks,
      projectDirName: entry.ref?.dirName ?? null,
      transcriptId: entry.ref?.sessionId ?? null,
      lastCompactionAt: entry.lastCompactionAt,
    }
  }

  /**
   * 会話ログのセッションID → Desktopのセッション(名前・グループ)。利用上限の「誰が使っているか」で、
   * 会話記録の使用量をセッション・グループに対応づけるために使う。
   */
  async sessionIdentities(): Promise<Map<string, SessionIdentity>> {
    await this.list()
    const map = new Map<string, SessionIdentity>()
    for (const b of this.built.values()) {
      if (!b.ref) continue
      map.set(b.ref.sessionId, {
        desktopId: b.summary.id,
        title: b.summary.title,
        groupId: b.summary.group?.id ?? null,
        groupName: b.summary.group?.name ?? null,
      })
    }
    return map
  }

  private cliProcessOf(cliSessionId: string | null): DesktopSessionSummary["cliProcess"] {
    if (this.cliIds === null || cliSessionId === null) return "unknown"
    return this.cliIds.has(cliSessionId.toLowerCase()) ? "running" : "none"
  }

  private countSessions(sessions: DesktopSessionSummary[], highContextRatio: number): DesktopSessionCounts {
    const active = sessions.filter((s) => !s.isArchived)
    return {
      total: active.length,
      running: active.filter((s) => s.status === "running").length,
      blocked: active.filter((s) => s.status === "blocked").length,
      reviewReady: active.filter((s) => s.status === "review_ready").length,
      highContext: active.filter((s) => s.context !== null && s.context.ratio >= highContextRatio).length,
      archived: sessions.length - active.length,
    }
  }

  private collectGroups(sessions: DesktopSessionSummary[], prefs: SidebarPrefs | null): DesktopSessionGroup[] {
    if (!prefs) return []
    const counts = new Map<string, number>()
    for (const s of sessions) {
      if (s.group && !s.isArchived) counts.set(s.group.id, (counts.get(s.group.id) ?? 0) + 1)
    }
    return [...prefs.groups.values()]
      .map((g) => ({ id: g.id, name: g.name, order: g.order, count: counts.get(g.id) ?? 0 }))
      .sort((a, b) => a.order - b.order)
  }

  private build(
    meta: DesktopMeta | null,
    ref: TranscriptRef | null,
    digest: TranscriptDigest | null,
    transcriptMtimeMs: number | null,
    prefs: SidebarPrefs | null,
    now: number
  ): BuiltSession {
    const id = meta?.id ?? ref?.sessionId ?? "unknown"
    const model = meta?.model ?? digest?.model ?? null
    const cwd = meta?.cwd ?? digest?.cwd ?? null

    const { status, reason, awaitingAnswer } = inferStatus(
      { meta, digest, transcriptMtimeMs, now },
      this.opts.thresholds ?? DEFAULT_THRESHOLDS
    )

    let context: DesktopSessionSummary["context"] = null
    if (digest?.context) {
      const tokens = digest.context.tokens
      const limit = resolveContextLimit(digest.context.model ?? model, tokens, this.opts.contextLimits)
      context = { tokens, limit, ratio: Math.min(1, tokens / limit) }
    }

    const tasks: DesktopSessionTask[] = (digest?.tasks ?? []).map((t) => ({ content: t.content, status: t.status }))
    let phase: DesktopSessionSummary["phase"] = null
    if (tasks.length > 0) {
      const current = tasks.find((t) => t.status === "in_progress")
      phase = {
        completed: tasks.filter((t) => t.status === "completed").length,
        total: tasks.length,
        currentStep: current ? makeExcerpt(current.content, STEP_EXCERPT_CHARS) : null,
      }
    }

    const instruction = digest?.latestHuman ?? digest?.latestInput ?? null
    const groupId = prefs?.assignments.get(id)
    const group = groupId ? prefs?.groups.get(groupId) : undefined
    const input = digest?.latestInput
    const lastActivityAt = Math.max(meta?.lastActivityAt ?? 0, digest?.lastEventAt ?? 0) || null

    const summary: DesktopSessionSummary = {
      id,
      title: meta?.title || digest?.title || (digest?.latestHuman?.excerpt ?? "") || "（無題）",
      cwd,
      folderName: baseName(cwd),
      model,
      effort: meta?.effort ?? digest?.effort ?? null,
      permissionMode: meta?.permissionMode ?? digest?.permissionMode ?? null,
      isArchived: meta?.isArchived ?? false,
      isRoutine: meta?.isRoutine ?? false,
      pinned: prefs?.pinned.has(id) ?? false,
      group: group ? { id: group.id, name: group.name } : null,
      status,
      statusReason: reason,
      needsAction: status === "blocked" && (meta?.needsAction ?? false),
      // 要約文は前のターンのもの。回答待ちなど、会話ログからの判断で要対応になった場合は当てはまらないので出さない
      needsActionExcerpt: status === "blocked" && !awaitingAnswer ? (meta?.needsActionExcerpt ?? null) : null,
      createdAt: meta?.createdAt ?? null,
      lastActivityAt,
      completedTurns: meta?.completedTurns ?? null,
      transcript: ref && digest ? "found" : "missing",
      digest: !digest ? "none" : digest.complete ? "full" : "partial",
      context,
      lastAssistantAt: digest?.lastAssistantAt ?? null,
      phase,
      compactionCount: digest?.complete ? digest.compactionCount : null,
      latestInstruction: instruction
        ? {
            excerpt: makeExcerpt(instruction.excerpt, INSTRUCTION_EXCERPT_CHARS),
            origin: instruction.origin,
            at: instruction.at,
          }
        : null,
      latestInputOrigin: input?.origin ?? null,
      queuedInputs: digest?.queued ?? 0,
      messaging: digest ? messagingOf(digest) : null,
      cliProcess: this.cliProcessOf(meta?.cliSessionId ?? ref?.sessionId ?? null),
      spawnedFromId: meta?.spawnedFromId ?? null,
    }
    return { summary, tasks, ref, lastCompactionAt: digest?.lastCompactionAt ?? null }
  }
}

// ---------------------------------------------------------------------------
// アプリ全体で共有するインスタンス

interface DesktopSessionConfigFile {
  dataDir?: unknown
  projectsRoot?: unknown
  contextLimits?: unknown
  highContextRatio?: unknown
  runningWindowSec?: unknown
  pendingWindowSec?: unknown
  orchestratorPrefix?: unknown
  housekeeping?: unknown
}

/** 設定ファイルの `housekeeping`(idleMinutes・minIdleTokens・unansweredMinutes)を読む。正の数でない項目は無視する */
export function parseHousekeepingConfig(raw: Record<string, unknown>): Partial<HousekeepingThresholds> {
  const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null)
  const result: Partial<HousekeepingThresholds> = {}
  const idleMinutes = positive(raw.idleMinutes)
  if (idleMinutes !== null) result.idleMs = idleMinutes * 60_000
  const minIdleTokens = positive(raw.minIdleTokens)
  if (minIdleTokens !== null) result.minIdleTokens = minIdleTokens
  const unansweredMinutes = positive(raw.unansweredMinutes)
  if (unansweredMinutes !== null) result.unansweredMs = unansweredMinutes * 60_000
  return result
}

async function loadConfigFile(): Promise<DesktopSessionServiceOptions> {
  let raw: DesktopSessionConfigFile
  try {
    raw = JSON.parse(await fs.readFile(path.join(getAppDataRoot(), "config", "desktop-sessions.json"), "utf-8"))
  } catch {
    return {}
  }
  if (!raw || typeof raw !== "object") return {}
  const options: DesktopSessionServiceOptions = {}
  if (typeof raw.dataDir === "string" && raw.dataDir) options.dataDir = raw.dataDir
  if (typeof raw.projectsRoot === "string" && raw.projectsRoot) options.projectsRoot = raw.projectsRoot
  if (typeof raw.orchestratorPrefix === "string" && raw.orchestratorPrefix.trim()) {
    options.orchestratorPrefix = raw.orchestratorPrefix
  }
  if (typeof raw.highContextRatio === "number" && raw.highContextRatio > 0 && raw.highContextRatio <= 1) {
    options.highContextRatio = raw.highContextRatio
  }
  if (raw.housekeeping && typeof raw.housekeeping === "object") {
    options.housekeeping = parseHousekeepingConfig(raw.housekeeping as Record<string, unknown>)
  }
  if (raw.contextLimits && typeof raw.contextLimits === "object") {
    const limits: ContextLimitOverrides = {}
    for (const [k, v] of Object.entries(raw.contextLimits as Record<string, unknown>)) {
      if (typeof v === "number" && v > 0) limits[k] = v
    }
    options.contextLimits = limits
  }
  const running = typeof raw.runningWindowSec === "number" && raw.runningWindowSec > 0 ? raw.runningWindowSec : null
  const pending = typeof raw.pendingWindowSec === "number" && raw.pendingWindowSec > 0 ? raw.pendingWindowSec : null
  if (running || pending) {
    options.thresholds = {
      runningWindowMs: (running ?? DEFAULT_THRESHOLDS.runningWindowMs / 1000) * 1000,
      pendingWindowMs: (pending ?? DEFAULT_THRESHOLDS.pendingWindowMs / 1000) * 1000,
    }
  }
  return options
}

interface SharedService {
  service: Promise<DesktopSessionService>
  /** 作成時のクラス。開発中のホットリロードで古いクラスのインスタンスが残らないよう、現在のクラスと比べる */
  cls: unknown
}

const globalForService = globalThis as unknown as { __ccdDesktopSessionService?: SharedService }

/**
 * サーバー内で1つだけ作る。一覧APIと詳細APIが別のモジュールとして読み込まれても同じキャッシュを使えるよう、
 * globalThis に置く。
 */
export function getDesktopSessionService(): Promise<DesktopSessionService> {
  const existing = globalForService.__ccdDesktopSessionService
  if (existing && (process.env.NODE_ENV === "production" || existing.cls === DesktopSessionService)) {
    return existing.service
  }
  const service = loadConfigFile().then((fileOptions) => {
    const projectsRoot = process.env.CLAUDE_DESKTOP_PROJECTS_ROOT?.trim()
    return new DesktopSessionService({
      ...fileOptions,
      ...(projectsRoot ? { projectsRoot } : {}),
      cliProcesses: new CliProcessWatcher(),
    })
  })
  globalForService.__ccdDesktopSessionService = { service, cls: DesktopSessionService }
  return service
}
