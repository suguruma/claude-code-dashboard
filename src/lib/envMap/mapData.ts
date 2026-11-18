import type { EnvMapData, EnvMapEdge, EnvMapLayer, EnvMapNode, EnvMapProblem, EnvMapStrength } from "./envMapTypes"

/**
 * ⑲ map.json(04 が作る。Dashboard は読むだけ)を検査して、画面に要る項目だけにする(EM-1・EM-3)。DOM・fs に触れない純粋な関数。
 * - schema が 1 のとき・schema の無い古い形(11/14 まで)で必要な項目があるときだけ描く。2 以上は描かない(A4)
 * - 理想の箱(ghost)は除き、両端の残る線だけを返す(A1)
 * - 置き場・説明・名前・id・グループの台帳の値は、`C:\Users\<名前>`・`/home/<名前>` を `~` に伏せ直す(6章)
 * - ルートの写しに使う置き場(place・places)とグループの台帳(sessions)は MapIndex にだけ持ち、応答には入れない
 */

export const SUPPORTED_SCHEMA = 1
export const STALE_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export const PROBLEM_TEXT = {
  "no-config": "設定がありません。config/env-map.json に地図のファイルの場所(mapPath)を書いてください",
  missing: "地図のファイルが見つかりません。config/env-map.json の mapPath を確かめてください",
  broken: "地図のファイルを読めません(JSON の形が壊れています)。地図を作り直すと直ります",
  unreadable: "地図のファイルを読めません(大きすぎるか、開けない場所です)。config/env-map.json の mapPath を確かめてください",
  "newer-schema": "地図の形が新しくなりました。Dashboard の更新が要ります",
} as const

export function problemOf(kind: keyof typeof PROBLEM_TEXT): EnvMapProblem {
  return { kind, message: PROBLEM_TEXT[kind] }
}

function badShape(what: string): EnvMapProblem {
  return { kind: "bad-shape", message: `地図の形が違います(${what})。地図を作り直すか、Dashboard の更新が要ります` }
}

const USER_DIR = /([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"'<>|]+/gi
const HOME_DIR = /\/home\/[^/\s"'<>|]+/g

/** 個人のフォルダの名前を `~` に伏せる(04 が伏せ忘れた形が来たときの守り) */
export function maskUserPath(s: string): string {
  return s.replace(USER_DIR, "~").replace(HOME_DIR, "~")
}

const STRENGTHS = new Set<EnvMapStrength>(["stop", "judge", "watch", "read", "none"])

/** generated_at(日本時間・時差の印なし。"2026-11-18 09:41")をミリ秒に。読めなければ null */
export function parseJstTime(value: unknown): number | null {
  if (typeof value !== "string") return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim())
  if (!m) return null
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0) - 9 * 60 * 60 * 1000
  return Number.isNaN(ms) ? null : ms
}

/** グループの台帳の1行(ルートのグループ決めにだけ使う) */
export interface GroupSessionRow {
  group: string
  title: string
  /** 正規化した作業フォルダ(`~` は戻した形。戻せない形は null) */
  folder: string | null
}

/** ルートの写し(規則2・6)に使う、応答に入れない索引 */
export interface MapIndex {
  ids: Set<string>
  /** 正規化した置き場 → 箱の id(長い順) */
  places: { path: string; id: string }[]
  groups: GroupSessionRow[]
}

export interface ParsedMap {
  data: EnvMapData
  index: MapIndex
}

/** 比べるためのパスの正規化:区切りを \ に、末尾の区切りを除き、小文字に。`~\`・`~/`・`WSL ~/` はホームに戻す */
export function normalizePath(p: string, home: string): string | null {
  let s = p.trim()
  if (!s) return null
  if (/^WSL\b/i.test(s)) {
    // WSL の作業フォルダは Windows の会話記録のパスと比べられない(戻せない形は比べない。A5c)
    return null
  }
  s = s.replace(/\//g, "\\")
  if (s === "~" || s.startsWith("~\\")) s = home.replace(/\//g, "\\").replace(/\\+$/, "") + s.slice(1)
  if (!/^[A-Za-z]:\\/.test(s) && !s.startsWith("\\\\")) return null
  return s.replace(/\\+$/, "").toLowerCase()
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")

export function parseMap(raw: unknown, home: string, now: number): ParsedMap | EnvMapProblem {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return badShape("一番上が JSON のオブジェクトではありません")
  const r = raw as Record<string, unknown>
  let schema: number | null = null
  if (r.schema !== undefined) {
    if (typeof r.schema !== "number" || !Number.isInteger(r.schema)) return badShape("形の版が数ではありません")
    if (r.schema > SUPPORTED_SCHEMA) return problemOf("newer-schema")
    schema = r.schema
  }
  if (!Array.isArray(r.layers)) return badShape("層の一覧がありません")
  if (!Array.isArray(r.nodes)) return badShape("箱の一覧がありません")
  const rawEdges = Array.isArray(r.edges) ? r.edges : []

  const layers: EnvMapLayer[] = []
  for (const l of r.layers) {
    if (!l || typeof l !== "object") continue
    const id = str((l as Record<string, unknown>).id)
    if (!id || layers.some((x) => x.id === id)) continue
    layers.push({ id, label: maskUserPath(str((l as Record<string, unknown>).label) || id) })
  }
  if (layers.length === 0) return badShape("層の一覧が空です")
  const layerIds = new Set(layers.map((l) => l.id))

  const nodes: EnvMapNode[] = []
  const places: MapIndex["places"] = []
  const groups: GroupSessionRow[] = []
  const seen = new Set<string>()
  for (const n of r.nodes) {
    if (!n || typeof n !== "object") continue
    const o = n as Record<string, unknown>
    const rawId = str(o.id)
    if (!rawId || seen.has(rawId) || o.ghost === true || !layerIds.has(str(o.layer))) continue
    seen.add(rawId)
    const strength = STRENGTHS.has(o.strength as EnvMapStrength) ? (o.strength as EnvMapStrength) : "none"
    nodes.push({
      id: rawId,
      layer: str(o.layer),
      label: maskUserPath(str(o.label) || rawId),
      kind: maskUserPath(str(o.kind)),
      strength,
      place: maskUserPath(str(o.place)),
      desc: maskUserPath(str(o.desc)),
      degree: 0,
    })
    const placeList: unknown[] = [o.place, ...(Array.isArray(o.places) ? o.places : [])]
    for (const p of placeList) {
      const where = typeof p === "string" ? p : p && typeof p === "object" ? str((p as Record<string, unknown>).where) : ""
      // 置き場らしい形(区切りを含む)だけを比べる
      if (!where || !/[\\/]/.test(where)) continue
      const norm = normalizePath(where, home)
      if (norm) places.push({ path: norm, id: rawId })
    }
    if (Array.isArray(o.sessions)) {
      for (const s of o.sessions) {
        if (!s || typeof s !== "object") continue
        const title = str((s as Record<string, unknown>).title).trim()
        const folder = str((s as Record<string, unknown>).folder)
        groups.push({ group: rawId, title, folder: folder ? normalizePath(folder, home) : null })
      }
    }
  }
  const ids = new Set(nodes.map((n) => n.id))

  const edges: EnvMapEdge[] = []
  const degree = new Map<string, number>()
  for (const e of rawEdges) {
    if (!e || typeof e !== "object") continue
    const o = e as Record<string, unknown>
    const src = str(o.src)
    const dst = str(o.dst)
    if (!ids.has(src) || !ids.has(dst) || src === dst) continue
    edges.push({ src, dst, label: maskUserPath(str(o.label)), conflict: str(o.kind) === "conflict" })
    degree.set(src, (degree.get(src) ?? 0) + 1)
    degree.set(dst, (degree.get(dst) ?? 0) + 1)
  }
  for (const n of nodes) n.degree = degree.get(n.id) ?? 0
  // 応答の id も伏せる(rule: の箱は id が丸ごとパスのことがある)。線の両端も同じ写しにする
  const idMap = new Map(nodes.map((n) => [n.id, maskUserPath(n.id)]))
  for (const n of nodes) n.id = idMap.get(n.id) ?? n.id
  for (const e of edges) {
    e.src = idMap.get(e.src) ?? e.src
    e.dst = idMap.get(e.dst) ?? e.dst
  }
  for (const p of places) p.id = idMap.get(p.id) ?? p.id
  for (const g of groups) g.group = idMap.get(g.group) ?? g.group
  places.sort((a, b) => b.path.length - a.path.length)

  const generatedAt = parseJstTime(r.generated_at)
  return {
    data: {
      schema,
      generatedAt,
      stale: generatedAt !== null && now - generatedAt > STALE_DAYS * DAY_MS,
      layers,
      nodes,
      edges,
    },
    index: { ids: new Set(nodes.map((n) => n.id)), places, groups },
  }
}

export function isProblem(v: ParsedMap | EnvMapProblem): v is EnvMapProblem {
  return "message" in v && "kind" in v && !("data" in v)
}
