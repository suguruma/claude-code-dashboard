import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { locateData, type Env } from "./dataLocations"
import { getDesktopSessionService, type DesktopSessionService, type RelationSource } from "./desktopSessionService"
import { getAppDataRoot } from "./fileIO"
import { SEND_MATCH_WINDOW_MS } from "./flowEvents"
import { FlowSignalReader } from "./flowReader"
import { collectDecisions } from "./housekeeping"
import { lastSegment, redactPathsInText } from "./lanAccess/redact"
import { GLOBAL_CLAUDE_MD_ENV, loadOrgRulesConfig } from "./orgRulesService"
import {
  DEFAULT_ROLE_LABELS,
  type CrossGroupRequest,
  type EffectItem,
  type LedgerMark,
  type RelationEffects,
  type RelationGroup,
  type RelationRole,
  type RelationSession,
  type RelationsResponse,
  type RoleLabels,
} from "./relationsTypes"
import { maskSecrets } from "./secretMask"
import { getPreviewBlockReason } from "./sensitivePaths"

/**
 * 関係性マップ(⑬ 組織のページの「つながり」)のデータを組み立てる。読み取り専用・外部との通信なし・LLM を呼ばない。
 *
 * 効く先は、推さずに決められる出どころだけで出す(要件メモ 4-2 (b)・A16)：
 * - 全体の決まり：グローバルの CLAUDE.md。全セッションに効く(更新時刻だけを見る)
 * - 作業フォルダの決まり：セッションの作業フォルダと、その上のフォルダの CLAUDE.md(あるかと更新時刻だけ。本文は読まない)。
 *   クラウドのフォルダ(OneDrive・Google Drive・Dropbox)は中を調べない
 * - 記憶：会話ログのファイルと同じフォルダの memory(ファイルの数と更新時刻だけ)
 * - スキル：ユーザーのスキルの数と、会話ログの Skill の呼び出し(直近30日)
 * - 指示のファイル・報告の台帳：設定(`config/relations.json`)で担当と結んだものだけ。見出しの番号と更新時刻だけを読む
 * 役割は、設定の題名の決まり(leaderPattern・helperPattern。既定は組織図と同じ指揮役の頭「00_」と「補助」)だけで決め、ほかの推しはしない。
 * グループをまたぐ頼みは、Desktop の送った記録(peerReceipts)の宛先が別のグループのものだけ。要旨は、送り手の会話ログの送信と
 * 時刻(1分以内)と宛先で結べたときだけ、組織図と同じ先頭20字を出す。
 */

export const USER_SKILLS_DIR_ENV = "CCD_USER_SKILLS_DIR"
const SKILL_WINDOW_MS = 30 * 24 * 60 * 60_000
const MAX_LEDGER_BYTES = 4 * 1024 * 1024
const MAX_PARENT_DEPTH = 6
/** グループをまたぐ頼みを数える期間 */
export const CROSS_WINDOW_MS = 7 * 24 * 60 * 60_000

export interface RelationMember {
  /** 題名の先頭がこれで始まるセッションに結ぶ(例「01_」) */
  titlePrefix: string
  /** サイドバーのグループの名前か ID。書いてあれば、グループも一致したときだけ結ぶ(同じ番号の担当が別のグループにいるとき) */
  group?: string
  ordersFile?: string
  reportsFile?: string
}

export interface RelationsConfig {
  leaderPattern?: string
  helperPattern?: string
  roleLabels?: Partial<RoleLabels>
  members?: RelationMember[]
  /** 指示のファイルの見出し(既定「### 指示N:」) */
  ordersHeading?: string
  /** 報告の台帳の見出し(既定「### 報告N」) */
  reportsHeading?: string
}

/** 設定ファイル(`config/relations.json`)を読む。無ければ null(画面は指示の置き場の札を出さない) */
export async function loadRelationsConfig(): Promise<RelationsConfig | null> {
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(path.join(getAppDataRoot(), "config", "relations.json"), "utf-8"))
  } catch {
    return null
  }
  return parseRelationsConfig(raw)
}

export function parseRelationsConfig(raw: unknown): RelationsConfig {
  if (!raw || typeof raw !== "object") return {}
  const r = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined)
  const config: RelationsConfig = {
    leaderPattern: str(r.leaderPattern),
    helperPattern: str(r.helperPattern),
    ordersHeading: str(r.ordersHeading),
    reportsHeading: str(r.reportsHeading),
  }
  if (r.roleLabels && typeof r.roleLabels === "object") {
    const l = r.roleLabels as Record<string, unknown>
    config.roleLabels = { leader: str(l.leader), member: str(l.member), helper: str(l.helper) }
  }
  if (Array.isArray(r.members)) {
    config.members = r.members
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
      .map((m) => ({
        titlePrefix: str(m.titlePrefix) ?? "",
        group: str(m.group),
        ordersFile: str(m.ordersFile),
        reportsFile: str(m.reportsFile),
      }))
      .filter((m) => m.titlePrefix !== "")
  }
  return config
}

/** 題名の決まりの文字列から、前方一致の正規表現を作る(正規表現として書かれていればそのまま。壊れていれば前方一致の文字) */
function patternOf(value: string | undefined, fallback: string): RegExp {
  const v = value ?? fallback
  try {
    return new RegExp(/^[\^]/.test(v) ? v : `^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
  } catch {
    return new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
  }
}

/** 役割を、題名の決まりだけで決める(A12) */
export function roleOf(title: string, leader: RegExp, helper: RegExp): RelationRole {
  if (leader.test(title)) return "leader"
  if (helper.test(title)) return "helper"
  return "member"
}

/** クラウドのフォルダ(中を走査しない決まり)か */
export function isCloudFolder(p: string): boolean {
  return /[\\/](OneDrive|Dropbox|Google Drive|GoogleDrive|iCloudDrive)([\\/ -]|$)/i.test(p) || /^G:[\\/]/i.test(p)
}

/** 見出しの番号を拾う正規表現(「### 指示43:」「### 報告64：」) */
function headingPattern(prefix: string | undefined, word: string): RegExp {
  const head = (prefix ?? `### ${word}`).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${head}(\\d+)`, "gm")
}

/** 指示のファイル・報告の台帳の、最後の見出しの番号と更新時刻だけを読む(本文は返さない) */
export async function readLedgerMark(filePath: string, pattern: RegExp): Promise<LedgerMark> {
  const name = path.basename(filePath)
  if (getPreviewBlockReason(filePath)) return { name, lastNumber: null, updatedAt: null, status: "refused" }
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile() || stat.size > MAX_LEDGER_BYTES) return { name, lastNumber: null, updatedAt: stat.mtimeMs, status: "unreadable" }
    const text = await fs.readFile(filePath, "utf-8")
    let last: number | null = null
    for (const m of text.matchAll(pattern)) last = Math.max(last ?? 0, Number(m[1]))
    return { name, lastNumber: last, updatedAt: stat.mtimeMs, status: "ok" }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return { name, lastNumber: null, updatedAt: null, status: code === "ENOENT" ? "missing" : "unreadable" }
  }
}

async function mtimeOf(p: string): Promise<number | null> {
  try {
    const stat = await fs.stat(p)
    return stat.isFile() ? stat.mtimeMs : null
  } catch {
    return null
  }
}

export interface RelationsServiceOptions {
  config?: () => Promise<RelationsConfig | null>
  globalClaudeMdPath?: () => Promise<string | undefined>
  env?: Env
  now?: () => number
  reader?: FlowSignalReader
}

export class RelationsService {
  private readonly env: Env
  private readonly now: () => number
  private readonly reader: FlowSignalReader

  constructor(
    private readonly sessions: DesktopSessionService,
    private readonly options: RelationsServiceOptions = {}
  ) {
    this.env = options.env ?? process.env
    this.now = options.now ?? Date.now
    this.reader = options.reader ?? new FlowSignalReader()
  }

  async get(): Promise<RelationsResponse> {
    const config = await (this.options.config ?? loadRelationsConfig)()
    const { list, sources } = await this.sessions.relationSources()
    const now = this.now()
    const leader = patternOf(config?.leaderPattern, this.sessions.orchestratorPrefix())
    const helper = patternOf(config?.helperPattern, "補助")
    const roleLabels: RoleLabels = {
      leader: config?.roleLabels?.leader ?? DEFAULT_ROLE_LABELS.leader,
      member: config?.roleLabels?.member ?? DEFAULT_ROLE_LABELS.member,
      helper: config?.roleLabels?.helper ?? DEFAULT_ROLE_LABELS.helper,
    }

    // 作業フォルダ → それを使うセッション(同じ作業フォルダの名前を出すため)
    const byFolder = new Map<string, string[]>()
    for (const s of sources) {
      const cwd = s.summary.cwd
      if (!cwd) continue
      const key = path.resolve(cwd).toLowerCase()
      byFolder.set(key, [...(byFolder.get(key) ?? []), s.summary.id])
    }

    const ordersPattern = headingPattern(config?.ordersHeading, "指示")
    const reportsPattern = headingPattern(config?.reportsHeading, "報告")
    const sessions: RelationSession[] = []
    for (const s of sources) {
      const sum = s.summary
      // グループを書いた結びを先に見る(書いていない結びが前にあっても、グループの一致する方を選ぶ)
      const byTitle = config?.members?.filter((m) => sum.title.startsWith(m.titlePrefix)) ?? []
      const member =
        byTitle.find((m) => m.group && (m.group === sum.group?.id || m.group === sum.group?.name)) ??
        byTitle.find((m) => !m.group) ??
        null
      const folderKey = sum.cwd ? path.resolve(sum.cwd).toLowerCase() : null
      sessions.push({
        id: sum.id,
        title: sum.title,
        groupId: sum.group?.id ?? null,
        role: roleOf(sum.title, leader, helper),
        spawnedFromId: sum.spawnedFromId,
        status: sum.status,
        folderName: sum.folderName,
        branch: s.relation.writtenBranch,
        sameFolderIds: folderKey ? (byFolder.get(folderKey) ?? []).filter((id) => id !== sum.id) : [],
        orders: member?.ordersFile ? await readLedgerMark(member.ordersFile, ordersPattern) : null,
        reports: member?.reportsFile ? await readLedgerMark(member.reportsFile, reportsPattern) : null,
        lastActivityAt: sum.lastActivityAt,
      })
    }

    const crossGroup = await this.crossGroup(sources, now)
    const decisions = new Map<string, number>()
    for (const d of collectDecisions(list.sessions)) {
      const g = list.sessions.find((s) => s.id === d.id)?.group?.id ?? "none"
      decisions.set(g, (decisions.get(g) ?? 0) + 1)
    }
    const groups: RelationGroup[] = list.groups.map((g) => this.groupOf(g.id, g.name, sessions, decisions, crossGroup))
    if (sessions.some((s) => s.groupId === null)) groups.push(this.groupOf("none", "グループ外", sessions, decisions, crossGroup))

    return {
      generatedAt: now,
      crossWindowMs: CROSS_WINDOW_MS,
      status: list.source === "desktop" ? "ok" : "no-desktop",
      configured: config !== null,
      roleLabels,
      groups: groups.filter((g) => g.count > 0),
      sessions,
      effects: await this.effects(sources, now),
      crossGroup,
    }
  }

  private groupOf(
    id: string,
    name: string,
    sessions: RelationSession[],
    decisions: Map<string, number>,
    crossGroup: CrossGroupRequest[]
  ): RelationGroup {
    const inGroup = sessions.filter((s) => (s.groupId ?? "none") === id)
    return {
      id,
      name,
      count: inGroup.length,
      decisions: decisions.get(id) ?? 0,
      unansweredRequests: crossGroup.filter((r) => (r.fromGroupId ?? "none") === id && r.repliedAt === null).length,
      spawnedLinks: inGroup.filter((s) => s.spawnedFromId !== null).length,
    }
  }

  /** グループをまたぐ頼み：送った記録の宛先が、別のグループ(グループ外を含む)のセッションのものだけ(A17) */
  private async crossGroup(sources: RelationSource[], now: number): Promise<CrossGroupRequest[]> {
    const byId = new Map(sources.map((s) => [s.summary.id, s.summary]))
    const horizon = now - CROSS_WINDOW_MS
    const out: CrossGroupRequest[] = []
    for (const s of sources) {
      const from = s.summary.group?.id ?? null
      const crossing = s.relation.peerReceipts.filter((r) => {
        const target = byId.get(r.targetSessionId)
        return !!target && (target.group?.id ?? null) !== from && r.sentAt !== null && r.sentAt >= horizon
      })
      if (crossing.length === 0) continue
      const sends = s.filePath ? (await this.reader.read(s.filePath, horizon)).sends : []
      for (const r of crossing) {
        const target = byId.get(r.targetSessionId)!
        out.push({
          fromId: s.summary.id,
          toId: r.targetSessionId,
          summary: summaryOfReceipt(sends, r.sentAt, target.id, target.title),
          fromGroupId: from,
          toGroupId: target.group?.id ?? null,
          ...pickReceipt(r),
        })
      }
    }
    return out.sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))
  }

  private async effects(sources: RelationSource[], now: number): Promise<RelationEffects> {
    // 全体の決まり
    const orgConfig = await loadOrgRulesConfig().catch(() => ({ globalClaudeMdPath: undefined }))
    const globalConfigured = this.options.globalClaudeMdPath ? await this.options.globalClaudeMdPath() : orgConfig.globalClaudeMdPath
    const where = locateData(globalConfigured, GLOBAL_CLAUDE_MD_ENV, () => path.join(os.homedir(), ".claude", "CLAUDE.md"), this.env)
    const globalAt = where.path ? await mtimeOf(where.path) : null
    const global: RelationEffects["global"] = where.path ? { status: globalAt === null ? "missing" : "ok", updatedAt: globalAt } : { status: "disabled", updatedAt: null }

    // 作業フォルダの決まり(作業フォルダとその上のフォルダの CLAUDE.md)
    const folderRules = new Map<string, EffectItem>()
    let cloudSkipped = 0
    const seenCwd = new Map<string, string[]>()
    for (const s of sources) {
      if (!s.summary.cwd) continue
      const key = path.resolve(s.summary.cwd)
      seenCwd.set(key, [...(seenCwd.get(key) ?? []), s.summary.id])
    }
    for (const [cwd, ids] of seenCwd) {
      if (isCloudFolder(cwd)) {
        cloudSkipped++
        continue
      }
      let dir = cwd
      for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
        const file = path.join(dir, "CLAUDE.md")
        if (!getPreviewBlockReason(file)) {
          const at = await mtimeOf(file)
          if (at !== null) {
            const k = file.toLowerCase()
            const item = folderRules.get(k) ?? { key: `rule:${folderRules.size + 1}`, label: lastSegment(dir) || dir, updatedAt: at, sessionIds: [] }
            item.sessionIds = [...new Set([...item.sessionIds, ...ids])]
            folderRules.set(k, item)
          }
        }
        const parent = path.dirname(dir)
        if (parent === dir) break
        dir = parent
      }
    }

    // 記憶(会話ログの置き場の memory)
    const memories = new Map<string, EffectItem>()
    for (const s of sources) {
      if (!s.filePath) continue
      const memDir = path.join(path.dirname(s.filePath), "memory")
      const k = memDir.toLowerCase()
      let item = memories.get(k)
      if (!item) {
        let files = 0
        let latest: number | null = null
        try {
          for (const entry of await fs.readdir(memDir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue
            files++
            const at = await mtimeOf(path.join(memDir, entry.name))
            if (at !== null && (latest === null || at > latest)) latest = at
          }
        } catch {
          // 記憶のフォルダが無い
        }
        if (files === 0) continue
        item = { key: `memory:${memories.size + 1}`, label: "会話ログのフォルダの memory", updatedAt: latest, sessionIds: [], count: files }
        memories.set(k, item)
      }
      item.sessionIds.push(s.summary.id)
    }

    // スキル
    const skillsDir = locateData(null, USER_SKILLS_DIR_ENV, () => path.join(os.homedir(), ".claude", "skills"), this.env)
    let userSkills: number | null = null
    if (skillsDir.path) {
      try {
        userSkills = (await fs.readdir(skillsDir.path, { withFileTypes: true })).filter((e) => e.isDirectory()).length
      } catch {
        userSkills = 0
      }
    }
    const used = new Map<string, { calls: number; sessionIds: Set<string> }>()
    for (const s of sources) {
      for (const call of s.relation.skillCalls) {
        if (call.at === null || now - call.at > SKILL_WINDOW_MS) continue
        const u = used.get(call.name) ?? { calls: 0, sessionIds: new Set<string>() }
        u.calls++
        u.sessionIds.add(s.summary.id)
        used.set(call.name, u)
      }
    }

    return {
      global,
      folderRules: [...folderRules.values()],
      memories: [...memories.values()],
      userSkills,
      usedSkills: [...used.entries()]
        .map(([name, u]) => ({ name, calls: u.calls, sessionIds: [...u.sessionIds] }))
        .sort((a, b) => b.calls - a.calls),
      cloudSkipped,
    }
  }
}

/** 送った記録に、会話ログの送信(時刻が1分以内・宛先が ID か題名)を結び、要旨の先頭20字を返す */
export function summaryOfReceipt(
  sends: ReadonlyArray<{ t: number; targets: string[]; summary: string }>,
  sentAt: number | null,
  targetId: string,
  targetTitle: string
): string | null {
  if (sentAt === null) return null
  let best: { gap: number; summary: string } | null = null
  for (const send of sends) {
    const gap = Math.abs(send.t - sentAt)
    if (gap > SEND_MATCH_WINDOW_MS || !send.targets.some((x) => x === targetId || x === targetTitle)) continue
    if (!best || gap < best.gap) best = { gap, summary: send.summary }
  }
  const text = best ? maskSecrets(redactPathsInText(best.summary)).trim() : ""
  return text || null
}

function pickReceipt(r: RelationSource["relation"]["peerReceipts"][number]) {
  return { sentAt: r.sentAt, delivery: r.delivery, deliveredAt: r.deliveredAt, readAt: r.readAt, repliedAt: r.repliedAt }
}

let shared: Promise<RelationsService> | null = null

export function getRelationsService(): Promise<RelationsService> {
  if (!shared) shared = getDesktopSessionService().then((sessions) => new RelationsService(sessions))
  return shared
}
