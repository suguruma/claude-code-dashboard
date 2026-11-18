import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { getDesktopSessionService, type EnvMapSource } from "@/lib/desktopSessionService"
import { getAppDataRoot } from "@/lib/fileIO"
import { getPreviewBlockReason } from "@/lib/sensitivePaths"
import type { EnvMapProblem, EnvMapResponse, EnvMapSessionItem, RouteResponse } from "./envMapTypes"
import { isProblem, parseMap, problemOf, type ParsedMap } from "./mapData"
import { readRoute, type RouteReadState } from "./routeReader"
import { entryOf, groupOf } from "./routeRules"

/**
 * ⑲ AI 環境の全体マップのサービス(EM-1〜EM-4・EM-6〜EM-8)。
 * - 地図(map.json)は設定ファイルの場所から読むだけ。更新時刻と大きさが同じ間は覚えた結果を返す
 * - ルートは、選んだ1セッションの会話記録だけを、開いたときに読む(サブエージェントの記録は読まない。A5d)。
 *   読みながら箱の id と道具の名前に変え、入力の文はその場で捨てる(EM-6)。大きさと更新時刻が同じ間は覚える
 * - 読むだけ。外部と通信しない。LLM を呼ばない
 */

export const ENV_MAP_HORIZON_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_MAP_BYTES = 32 * 1024 * 1024
/** ルートを覚えておくセッションの数 */
const ROUTE_CACHE_SIZE = 8

export interface EnvMapConfig {
  mapPath: string | null
}

export type EnvMapConfigResult = { config: EnvMapConfig } | { problem: EnvMapProblem }

/** 設定ファイル(`config/env-map.json`)の中身を検査する。パスは文字列だけ受け取る */
export function parseEnvMapConfig(raw: unknown): EnvMapConfig {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const mapPath = typeof r.mapPath === "string" && r.mapPath.trim() ? r.mapPath.trim() : null
  return { mapPath }
}

export async function loadEnvMapConfig(root: string = getAppDataRoot()): Promise<EnvMapConfigResult> {
  let text: string
  try {
    text = await fs.readFile(path.join(root, "config", "env-map.json"), "utf-8")
  } catch {
    return { problem: problemOf("no-config") }
  }
  try {
    return { config: parseEnvMapConfig(JSON.parse(text)) }
  } catch {
    return { problem: { kind: "no-config", message: "設定ファイル config/env-map.json を読めません(JSON の形が壊れています)" } }
  }
}

export interface EnvMapServiceOptions {
  config: () => Promise<EnvMapConfigResult>
  sources: () => Promise<EnvMapSource[]>
  home?: string
  now?: () => number
  horizonDays?: number
}

interface MapCache {
  path: string
  mtimeMs: number
  size: number
  result: ParsedMap | EnvMapProblem
}

interface RouteCache {
  state: RouteReadState
  entry: string
  group: string | null
}

export class EnvMapService {
  private readonly opts: EnvMapServiceOptions
  private mapCache: MapCache | null = null
  private readonly routes = new Map<string, RouteCache>()
  private readonly inflight = new Map<string, Promise<RouteResponse | null>>()

  constructor(options: EnvMapServiceOptions) {
    this.opts = options
  }

  private now(): number {
    return (this.opts.now ?? Date.now)()
  }

  private get home(): string {
    return this.opts.home ?? os.homedir()
  }

  /** 地図を読む。描けないときは理由 */
  async loadMap(): Promise<ParsedMap | EnvMapProblem> {
    const cfg = await this.opts.config()
    if ("problem" in cfg) return cfg.problem
    const mapPath = cfg.config.mapPath
    if (!mapPath) return problemOf("no-config")
    if (getPreviewBlockReason(mapPath)) return problemOf("unreadable")
    let stat
    try {
      stat = await fs.stat(mapPath)
    } catch (e) {
      return problemOf((e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable")
    }
    if (!stat.isFile() || stat.size > MAX_MAP_BYTES) return problemOf("unreadable")
    const hit = this.mapCache
    if (hit && hit.path === mapPath && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.result
    let raw: unknown
    try {
      raw = JSON.parse(await fs.readFile(mapPath, "utf-8"))
    } catch {
      // 内容を含むエラー文は残さない
      const result = problemOf("broken")
      this.mapCache = { path: mapPath, mtimeMs: stat.mtimeMs, size: stat.size, result }
      return result
    }
    const result = parseMap(raw, this.home, this.now())
    this.mapCache = { path: mapPath, mtimeMs: stat.mtimeMs, size: stat.size, result }
    return result
  }

  private async recentSources(): Promise<EnvMapSource[]> {
    const since = this.now() - (this.opts.horizonDays ?? ENV_MAP_HORIZON_DAYS) * DAY_MS
    const all = await this.opts.sources()
    return all
      .filter((s) => s.transcriptPaths.length > 0 && (s.summary.lastActivityAt ?? 0) >= since)
      .sort((a, b) => (b.summary.lastActivityAt ?? 0) - (a.summary.lastActivityAt ?? 0))
  }

  async get(): Promise<EnvMapResponse> {
    const [map, sources] = await Promise.all([this.loadMap(), this.recentSources()])
    const sizeOf = async (p: string) => {
      try {
        return (await fs.stat(p)).size
      } catch {
        return 0
      }
    }
    const sessions: EnvMapSessionItem[] = await Promise.all(
      sources.map(async (s) => ({
        id: s.summary.id,
        title: s.summary.title,
        lastActivityAt: s.summary.lastActivityAt,
        archived: s.summary.isArchived,
        running: s.summary.status === "running",
        bytes: (await Promise.all(s.transcriptPaths.map(sizeOf))).reduce((a, b) => a + b, 0),
      }))
    )
    return {
      generatedAt: this.now(),
      map: isProblem(map) ? null : map.data,
      problem: isProblem(map) ? map : null,
      sessions,
      defaultSession: sessions[0]?.id ?? null,
    }
  }

  /** 1セッションのルート。セッションが無い(直近30日に動いていない・会話記録が無い)ときは null。同じセッションの同時の要求は1本にまとめる */
  route(sessionId: string): Promise<RouteResponse | null> {
    const running = this.inflight.get(sessionId)
    if (running) return running
    const job = this.readRouteOf(sessionId).finally(() => this.inflight.delete(sessionId))
    this.inflight.set(sessionId, job)
    return job
  }

  private async readRouteOf(sessionId: string): Promise<RouteResponse | null> {
    const src = (await this.recentSources()).find((s) => s.summary.id === sessionId)
    if (!src) return null
    const map = await this.loadMap()
    if (isProblem(map)) {
      return { sessionId, entry: "", group: null, instructions: [], bytes: 0, problem: map.message }
    }
    const files: { path: string; size: number; mtimeMs: number }[] = []
    for (const p of src.transcriptPaths) {
      try {
        const st = await fs.stat(p)
        if (st.isFile()) files.push({ path: p, size: st.size, mtimeMs: st.mtimeMs })
      } catch {
        // 前の会話記録が消えていることがある
      }
    }
    // 古い会話記録から順に読む(前の会話記録 → 本体)。並びは作成の順で決め、書き足しで入れ替わらないよう名前の順を添える
    files.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path))
    if (files.length > 1) {
      const main = src.transcriptPaths[0]
      const i = files.findIndex((f) => f.path === main)
      if (i >= 0 && i !== files.length - 1) files.push(...files.splice(i, 1))
    }
    const running = src.summary.status === "running"
    const entry = entryOf(src.taskId, map.index)
    const group = groupOf(src.summary.title, src.summary.cwd, map.index, this.home)
    const key = [this.mapCache?.path ?? "", this.mapCache?.size ?? 0, this.mapCache?.mtimeMs ?? 0, entry, group ?? ""].join("\n")
    const prev = this.routes.get(sessionId)
    let problem: string | null = null
    let state: RouteReadState
    try {
      state = await readRoute(prev?.state ?? null, key, files, { index: map.index, home: this.home, entry, group })
    } catch {
      // 内容を含むエラー文は返さない
      problem = "会話記録を読めませんでした。［読み直す］で、もう一度読みます"
      this.routes.delete(sessionId)
      return { sessionId, entry, group, instructions: [], bytes: 0, problem }
    }
    this.routes.delete(sessionId)
    this.routes.set(sessionId, { state, entry, group })
    while (this.routes.size > ROUTE_CACHE_SIZE) {
      const oldest = this.routes.keys().next().value
      if (oldest === undefined) break
      this.routes.delete(oldest)
    }
    return { sessionId, entry, group, instructions: state.builder.finish(running), bytes: state.bytes, problem }
  }
}

// ---------------------------------------------------------------------------
// アプリ全体で共有するインスタンス

interface SharedService {
  service: EnvMapService
  cls: unknown
}

const globalForService = globalThis as unknown as { __ccdEnvMapService?: SharedService }

export function getEnvMapService(): EnvMapService {
  const existing = globalForService.__ccdEnvMapService
  if (existing && (process.env.NODE_ENV === "production" || existing.cls === EnvMapService)) return existing.service
  const service = new EnvMapService({
    config: () => loadEnvMapConfig(),
    sources: async () => (await getDesktopSessionService()).envMapSources(),
  })
  globalForService.__ccdEnvMapService = { service, cls: EnvMapService }
  return service
}
