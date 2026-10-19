import { createHash } from "crypto"
import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { locateData, type Env } from "./dataLocations"
import { getDesktopSessionService, type DesktopSessionService, type GroupSource } from "./desktopSessionService"
import { getAppDataRoot } from "./fileIO"
import { pickLeader } from "./flowEvents"
import { parseFrontmatter } from "./frontmatter"
import {
  claudeMdSections,
  DEFAULT_PINNED_SECTIONS,
  findStaleRefs,
  markdownSections,
  memoryIndexTargets,
  pinSections,
  type SessionTitles,
} from "./orgRulesText"
import type {
  OrgExtraFile,
  OrgFolderCard,
  OrgMemory,
  OrgMemoryBodyResponse,
  OrgMemoryEntry,
  OrgRuleFile,
  OrgRulesResponse,
} from "./orgRulesTypes"
import { getPreviewBlockReason } from "./sensitivePaths"

/**
 * 組織のルールのページ(⑨)のデータを組み立てる。読み取り専用・外部との通信なし・LLM を呼ばない。
 *
 * 読むのは次だけ(要件メモ 5):
 * - グローバルの CLAUDE.md(`~/.claude/CLAUDE.md`。設定ファイル・環境変数で場所を変えられる。自動の探索を止めているときは指定した場所だけ)
 * - 指揮役の作業フォルダの CLAUDE.md(`<作業フォルダ>/CLAUDE.md` だけ。親フォルダ・`@` の読み込み先はたどらない)
 * - 指揮役の会話ログのあるフォルダの `memory`(作業フォルダのパスを符号化して探すことはしない)
 * - 設定ファイル `config/org-rules.json` の `extraFiles` に書いたファイル(.md・.txt、1MB まで)
 * 指揮役でないセッションのフォルダは、CLAUDE.md も記憶も読まない。どのファイルも、認証情報などの拒否リスト(getPreviewBlockReason)を通す。
 */

/** グローバルの CLAUDE.md の場所を明示する環境変数 */
export const GLOBAL_CLAUDE_MD_ENV = "CCD_GLOBAL_CLAUDE_MD"

const MAX_FILE_BYTES = 1024 * 1024
const MAX_MEMORY_FILES = 200
const MAX_MEMORY_BYTES = 256 * 1024
const MEMORY_INDEX = "MEMORY.md"

export interface OrgRulesConfig {
  /** 先頭に出す節(見出しの前方一致)。既定は DEFAULT_PINNED_SECTIONS */
  pinnedSections?: string[]
  /** グローバルの CLAUDE.md の場所。省略時は環境変数 → `~/.claude/CLAUDE.md` */
  globalClaudeMdPath?: string
  /** 追加で読むファイル */
  extraFiles?: Array<{ label: string; path: string }>
}

export interface OrgRulesServiceOptions {
  config?: () => Promise<OrgRulesConfig>
  env?: Env
  platform?: NodeJS.Platform
  now?: () => number
}

/** 設定ファイル(`config/org-rules.json`)を読む。形の合わない項目は無視する */
export async function loadOrgRulesConfig(): Promise<OrgRulesConfig> {
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(path.join(getAppDataRoot(), "config", "org-rules.json"), "utf-8"))
  } catch {
    return {}
  }
  return parseOrgRulesConfig(raw)
}

export function parseOrgRulesConfig(raw: unknown): OrgRulesConfig {
  if (!raw || typeof raw !== "object") return {}
  const r = raw as Record<string, unknown>
  const config: OrgRulesConfig = {}
  if (Array.isArray(r.pinnedSections)) {
    config.pinnedSections = r.pinnedSections.filter((s): s is string => typeof s === "string" && s.trim() !== "")
  }
  if (typeof r.globalClaudeMdPath === "string" && r.globalClaudeMdPath.trim()) config.globalClaudeMdPath = r.globalClaudeMdPath
  if (Array.isArray(r.extraFiles)) {
    config.extraFiles = r.extraFiles.flatMap((f) => {
      if (!f || typeof f !== "object") return []
      const { label, path: p } = f as Record<string, unknown>
      if (typeof p !== "string" || !p.trim()) return []
      return [{ label: typeof label === "string" && label.trim() ? label : path.basename(p), path: p }]
    })
  }
  return config
}

/** 作業フォルダごとの内部の記録(記憶のフォルダは画面に返さない) */
interface FolderRecord {
  key: string
  cwd: string
  groups: Array<{ groupName: string; leaderTitle: string }>
  /** 会話ログのあるフォルダの memory。会話ログが見つからなければ null */
  memoryDir: string | null
  foreign: boolean
}

const emptyFile = (status: OrgRuleFile["status"], p: string | null): OrgRuleFile => ({
  status,
  path: p,
  updatedAt: null,
  preamble: "",
  sections: [],
})

/** フォルダの同じさを比べるための形(Windows は大文字小文字・区切りの違いを無視する) */
function folderKey(cwd: string, platform: NodeJS.Platform): string {
  const trimmed = cwd.replace(/[\\/]+$/, "")
  return platform === "win32" ? trimmed.replace(/\//g, "\\").toLowerCase() : trimmed
}

function asTime(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value === "string") {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

export class OrgRulesService {
  private readonly env: Env
  private readonly platform: NodeJS.Platform
  private readonly now: () => number

  constructor(
    private readonly sessions: DesktopSessionService,
    private readonly options: OrgRulesServiceOptions = {}
  ) {
    this.env = options.env ?? process.env
    this.platform = options.platform ?? process.platform
    this.now = options.now ?? Date.now
  }

  private config(): Promise<OrgRulesConfig> {
    return (this.options.config ?? loadOrgRulesConfig)()
  }

  /** この PC からは読めない作業フォルダ(Windows で `/home/...` のような WSL のパス)。パスを推測して読み替えない(Q7) */
  private isForeign(cwd: string): boolean {
    return this.platform === "win32" && cwd.startsWith("/")
  }

  async get(): Promise<OrgRulesResponse> {
    const config = await this.config()
    const list = await this.sessions.list()
    const desktop = list.source === "desktop"
    const titles: SessionTitles | null = desktop
      ? {
          live: list.sessions.filter((s) => !s.isArchived).map((s) => s.title),
          archived: list.sessions.filter((s) => s.isArchived).map((s) => s.title),
        }
      : null

    // B. グローバルの CLAUDE.md
    const where = locateData(config.globalClaudeMdPath, GLOBAL_CLAUDE_MD_ENV, () => path.join(os.homedir(), ".claude", "CLAUDE.md"), this.env)
    const global = where.path ? await this.readRuleFile(where.path, "claude-md", titles) : emptyFile("disabled", null)
    global.sections = pinSections(global.sections, config.pinnedSections ?? DEFAULT_PINNED_SECTIONS)

    // C. 指揮役の作業フォルダ
    const folders: OrgFolderCard[] = []
    if (desktop) {
      for (const record of await this.collectFolders()) {
        folders.push({
          key: record.key,
          cwd: record.cwd,
          groups: record.groups,
          claudeMd: record.foreign ? emptyFile("wsl", path.posix.join(record.cwd, "CLAUDE.md")) : await this.readRuleFile(path.join(record.cwd, "CLAUDE.md"), "claude-md", titles),
          memory: record.foreign ? emptyMemory("wsl") : await this.readMemory(record.memoryDir, titles),
        })
      }
    }

    // D. 追加のファイル
    const extras: OrgExtraFile[] = []
    for (const extra of config.extraFiles ?? []) {
      extras.push({ label: extra.label, file: await this.readRuleFile(extra.path, "auto", titles) })
    }

    const countFile = (f: OrgRuleFile) => f.sections.reduce((n, s) => n + s.staleRefs.length, 0)
    const staleTotal =
      countFile(global) +
      folders.reduce((n, f) => n + countFile(f.claudeMd) + f.memory.entries.reduce((m, e) => m + e.staleCount, 0), 0) +
      extras.reduce((n, e) => n + countFile(e.file), 0)

    return {
      generatedAt: this.now(),
      global,
      foldersStatus: desktop ? "ok" : "no-desktop",
      folders,
      extras,
      staleChecked: titles !== null,
      staleTotal,
    }
  }

  /**
   * 記憶の本文(開いたときだけ)。folderKey は一覧の応答の key、fileName は一覧に出たファイル名。
   * 画面からパスを受け取らず、サーバーが作った一覧に載っているものだけを返す。見つからなければ null
   */
  async memoryBody(key: string, fileName: string): Promise<OrgMemoryBodyResponse | null> {
    const record = (await this.collectFolders()).find((r) => r.key === key)
    if (!record || record.foreign || !record.memoryDir) return null
    let names: string[]
    try {
      names = await fs.readdir(record.memoryDir)
    } catch {
      return null
    }
    if (fileName === MEMORY_INDEX || !names.includes(fileName) || !fileName.toLowerCase().endsWith(".md")) return null
    const file = path.join(record.memoryDir, fileName)
    if (getPreviewBlockReason(file)) return null
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size > MAX_MEMORY_BYTES) return null
      const content = (await fs.readFile(file, "utf-8")).replace(/^﻿/, "")
      let body = content
      try {
        body = parseFrontmatter(content).body
      } catch {
        // frontmatter が読めなければ、全体を本文として出す
      }
      const list = await this.sessions.list()
      const titles: SessionTitles | null =
        list.source === "desktop"
          ? { live: list.sessions.filter((s) => !s.isArchived).map((s) => s.title), archived: list.sessions.filter((s) => s.isArchived).map((s) => s.title) }
          : null
      return { fileName, body: body.trim(), staleRefs: titles ? findStaleRefs(body, titles) : [] }
    } catch {
      return null
    }
  }

  /** グループごとに指揮役を選び(組織図と同じ pickLeader)、作業フォルダごとにまとめる */
  private async collectFolders(): Promise<FolderRecord[]> {
    const list = await this.sessions.list()
    if (list.source !== "desktop") return []
    const prefix = this.sessions.orchestratorPrefix()
    const byKey = new Map<string, FolderRecord>()
    for (const group of list.groups) {
      const { group: info, sources } = await this.sessions.groupSources(group.id)
      if (!info) continue
      const leader = pickLeader(
        sources.map((s: GroupSource) => ({ source: s, id: s.summary.id, title: s.summary.title, createdAt: s.summary.createdAt })),
        prefix
      )?.source
      const cwd = leader?.summary.cwd
      if (!leader || !cwd) continue
      const k = folderKey(cwd, this.platform)
      let record = byKey.get(k)
      if (!record) {
        record = {
          key: createHash("sha1").update(k).digest("hex").slice(0, 12),
          cwd,
          groups: [],
          memoryDir: leader.filePath ? path.join(path.dirname(leader.filePath), "memory") : null,
          foreign: this.isForeign(cwd),
        }
        byKey.set(k, record)
      } else if (!record.memoryDir && leader.filePath) {
        record.memoryDir = path.join(path.dirname(leader.filePath), "memory")
      }
      record.groups.push({ groupName: info.name, leaderTitle: leader.summary.title })
    }
    return [...byKey.values()]
  }

  /**
   * ルールのファイルを1つ読む。kind は claude-md(`## 見出し` ごと)/ auto(.md は見出しごと・.txt はそのまま。それ以外は読まない)
   */
  private async readRuleFile(p: string, kind: "claude-md" | "auto", titles: SessionTitles | null): Promise<OrgRuleFile> {
    if (getPreviewBlockReason(p)) return emptyFile("refused", p)
    const ext = path.extname(p).toLowerCase()
    if (kind === "auto" && ext !== ".md" && ext !== ".txt") return emptyFile("unsupported", p)
    let stat
    try {
      stat = await fs.stat(p)
    } catch {
      return emptyFile("missing", p)
    }
    if (!stat.isFile()) return emptyFile("missing", p)
    if (stat.size > MAX_FILE_BYTES) return { ...emptyFile("too-large", p), updatedAt: stat.mtimeMs }
    let content: string
    try {
      content = (await fs.readFile(p, "utf-8")).replace(/^﻿/, "")
    } catch {
      return emptyFile("unreadable", p)
    }
    if (kind === "auto" && ext === ".txt") {
      const body = content.replace(/\r\n/g, "\n").trim()
      return {
        status: "ok",
        path: p,
        updatedAt: stat.mtimeMs,
        preamble: "",
        sections: [{ title: path.basename(p), enabled: true, body, staleRefs: titles ? findStaleRefs(body, titles) : [] }],
      }
    }
    const parsed = kind === "claude-md" ? claudeMdSections(content, titles) : markdownSections(content, titles)
    return { status: "ok", path: p, updatedAt: stat.mtimeMs, preamble: parsed.preamble, sections: parsed.sections }
  }

  /** 記憶の一覧(name・description・type・更新日)。本文は返さず、古い名前の数だけを数える */
  private async readMemory(dir: string | null, titles: SessionTitles | null): Promise<OrgMemory> {
    if (!dir) return emptyMemory("unknown")
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      return emptyMemory("missing")
    }
    const mdNames = names.filter((n) => n.toLowerCase().endsWith(".md"))
    const fileNames = mdNames.filter((n) => n !== MEMORY_INDEX).sort((a, b) => a.localeCompare(b)).slice(0, MAX_MEMORY_FILES)

    let targets: Set<string> | null = null
    if (mdNames.includes(MEMORY_INDEX)) {
      try {
        targets = memoryIndexTargets(await fs.readFile(path.join(dir, MEMORY_INDEX), "utf-8"))
      } catch {
        targets = null
      }
    }

    const entries: OrgMemoryEntry[] = []
    for (const fileName of fileNames) {
      const file = path.join(dir, fileName)
      if (getPreviewBlockReason(file)) continue
      let stat
      try {
        stat = await fs.stat(file)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      const entry: OrgMemoryEntry = {
        fileName,
        name: fileName.replace(/\.md$/i, ""),
        description: "",
        type: "unknown",
        updatedAt: stat.mtimeMs,
        staleCount: 0,
        notInIndex: targets !== null && !targets.has(fileName),
      }
      if (stat.size <= MAX_MEMORY_BYTES) {
        try {
          const content = (await fs.readFile(file, "utf-8")).replace(/^﻿/, "")
          let body = content
          try {
            const { data, body: b } = parseFrontmatter(content)
            body = b
            const metadata = (data.metadata && typeof data.metadata === "object" ? data.metadata : {}) as Record<string, unknown>
            if (typeof data.name === "string" && data.name.trim()) entry.name = data.name.trim()
            if (typeof data.description === "string") entry.description = data.description.trim()
            const type = metadata.type ?? data.type
            if (typeof type === "string" && type.trim()) entry.type = type.trim()
            entry.updatedAt = asTime(metadata.modified) ?? entry.updatedAt
          } catch {
            // frontmatter が読めなければ、ファイル名と更新日時だけを出す
          }
          entry.staleCount = titles ? findStaleRefs(body, titles).length : 0
        } catch {
          // 読めなければ、ファイル名と更新日時だけを出す
        }
      }
      entries.push(entry)
    }

    const typeCounts: Record<string, number> = {}
    for (const e of entries) typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1
    const present = new Set(mdNames)
    return {
      status: "ok",
      entries,
      typeCounts,
      hasIndex: targets !== null,
      missingFromDisk: targets ? [...targets].filter((t) => !present.has(t)).sort() : [],
    }
  }
}

function emptyMemory(status: OrgMemory["status"]): OrgMemory {
  return { status, entries: [], typeCounts: {}, hasIndex: false, missingFromDisk: [] }
}

export async function getOrgRulesService(): Promise<OrgRulesService> {
  return new OrgRulesService(await getDesktopSessionService())
}
