import {
  CONTINUATION_MARK,
  INTERRUPT_MARK,
  SYSTEM_WRAPPER,
  originOf,
  queuedOriginOf,
  type RawEntry,
} from "../transcriptDigest"
import { GUARD_BOX, type RouteCount, type RouteEmpty, type RouteInstruction, type RouteStep, type RouteVisit } from "./envMapTypes"
import { normalizePath, type MapIndex } from "./mapData"

/**
 * ⑲ ルートの読み取り(要件メモ 3-6 の規則1〜12。04 の仕様「ルートの重ね描き」を 2026-11-18 に写した物)。DOM・fs に触れない純粋な関数。
 * - 道具の入力(file_path・command・message など)は、箱の id と道具の名前に変えた時点で捨てる。返り値に入れない(EM-6・6章)
 * - サブエージェントの記録は読まない(A5d)。isSidechain の行も読まない
 */

export { GUARD_BOX }
export const ENTRY_DESKTOP = "entry:desktop"

/** 規則11:数えない道具(箱にも「ほか」にも入れない) */
const SKIP = /^(mcp__ccd_turn__|ToolSearch$|Task(Create|Update|List|Get|Stop|Output)$|TodoWrite$|mcp__ccd_view__|mcp__ccd_session__mark_chapter$)/
const SHELL = new Set(["Bash", "PowerShell", "mcp__terminal__run_in_terminal"])
const EDIT = new Set(["Edit", "Write", "NotebookEdit"])
const WEB = new Set(["WebSearch", "WebFetch"])
const OFFICE = /\.(docx|xlsx|pptx)$/i
/** 規則7:見張りのフックが前に動く道具(端末は run_in_terminal だけ) */
const GUARDED = new Set(["Bash", "PowerShell", "Read", "Grep", "Glob", "Monitor", "mcp__terminal__run_in_terminal"])

export type BoxResult = { kind: "skip" } | { kind: "box"; id: string } | { kind: "other"; name: string }

const strOf = (v: unknown): string => (typeof v === "string" ? v : "")

/** 規則6:Read・Edit・Write の file_path が置き場と同じか、その中なら、その箱 */
function placeBox(filePath: string, index: MapIndex, home: string): string | null {
  const f = normalizePath(filePath, home)
  if (!f) return null
  for (const p of index.places) {
    if (f === p.path || f.startsWith(p.path + "\\")) return p.id
  }
  return null
}

/** 1つの道具の呼び出しを、規則の当てる順(6 → 8 → 3・4・5 → 10 → 9)で箱に写す(規則12:1つの道具は1つの箱だけ) */
export function boxOf(name: string, input: Record<string, unknown>, index: MapIndex, home: string): BoxResult {
  if (SKIP.test(name)) return { kind: "skip" }
  const has = (id: string) => index.ids.has(id)
  const box = (id: string): BoxResult => (has(id) ? { kind: "box", id } : { kind: "other", name })
  const filePath = strOf(input.file_path) || strOf(input.notebook_path)
  // 6
  if ((name === "Read" || name === "Edit" || name === "Write") && filePath) {
    const hit = placeBox(filePath, index, home)
    if (hit) return { kind: "box", id: hit }
  }
  // 8 出口
  if (EDIT.has(name) && filePath && OFFICE.test(filePath)) return box("out:office")
  if (name === "Artifact" && (input.action === undefined || input.action === "publish")) return box("out:page")
  if (SHELL.has(name) && /\bgit\s+(?:-C\s+\S+\s+)?commit\b/.test(strOf(input.command))) return box("out:commit")
  if (name === "SendMessage" && strOf(input.message).trimStart().startsWith("[完了]")) return box("out:report")
  // 3
  if (name === "Skill") {
    const skill = strOf(input.skill) || strOf(input.command)
    if (skill.includes(":")) return box("tool:plugins")
    return has(`skill:${skill}`) ? { kind: "box", id: `skill:${skill}` } : { kind: "other", name }
  }
  // 4
  if (name === "Agent" || name === "Task") {
    const id = `agent:${strOf(input.subagent_type)}`
    return has(id) ? { kind: "box", id } : { kind: "other", name: "Agent" }
  }
  // 5
  if (name.startsWith("mcp__Claude_Browser__") || name.startsWith("mcp__claude-in-chrome__")) return box("tool:browser")
  if (name.startsWith("mcp__") && !/^mcp__(ccd_session__|ccd_session_mgmt__|terminal__)/.test(name)) {
    const id = `mcp:${name.split("__")[1] ?? ""}`
    return has(id) ? { kind: "box", id } : { kind: "other", name }
  }
  // 10 組み込みの道具
  if (SHELL.has(name)) return box("tool:cc-shell")
  if (EDIT.has(name)) return box("tool:cc-edit")
  if (WEB.has(name)) return box("tool:cc-web")
  if (name === "SendMessage" || name.startsWith("mcp__ccd_session__") || name.startsWith("mcp__ccd_session_mgmt__")) return box("tool:cc-comms")
  // 9(Read・Grep・Glob を含む)
  return { kind: "other", name }
}

/** 規則7:見張りのフックが前に動く道具か */
export function isGuarded(name: string): boolean {
  return GUARDED.has(name)
}

const MARKERS = ['"tool_use"', '"queued_command"'].map((m) => Buffer.from(m))
const USER_MARKERS = ['"type":"user"', '"type": "user"'].map((m) => Buffer.from(m))
const TOOL_RESULT = Buffer.from('"tool_result"')

/**
 * 会話記録の行のうち、ルートに要る行か(文字に直す前のバイト列で決める。巨大なツールの結果の行を解かずに飛ばす)。
 * 拾うのは、道具の呼び出しの行・作業中に届いた入力の行・ツールの結果を含まない user の行(人の入力の候補)
 */
export function acceptLine(line: Buffer): boolean {
  if (MARKERS.some((m) => line.includes(m))) return true
  return USER_MARKERS.some((m) => line.includes(m)) && !line.includes(TOOL_RESULT)
}

interface RawBlockLike {
  type?: string
  id?: string
  name?: string
  input?: unknown
  text?: string
}

/**
 * 指示の区切り(規則1・A6)。人の入力(origin が human)と、予定タスクの入力(scheduled)だけが新しい指示を始める。
 * ツールの結果だけの行・他のセッションからの知らせ・通知・isMeta・要約(compact)・システムの差し込み・中断の印は区切りにしない
 */
export function startsInstruction(entry: RawEntry): boolean {
  if (entry.isSidechain) return false
  if (entry.type === "attachment") return queuedOriginOf(entry.attachment) === "human"
  if (entry.type !== "user" || entry.isMeta || entry.isCompactSummary) return false
  const content = entry.message?.content
  let text: string | null = null
  if (typeof content === "string") text = content
  else if (Array.isArray(content)) {
    if (content.some((b) => (b as RawBlockLike)?.type === "tool_result")) return false
    const block = content.find((b) => (b as RawBlockLike)?.type === "text" && typeof (b as RawBlockLike).text === "string")
    text = block ? ((block as RawBlockLike).text as string) : null
    // 画像だけの入力も人の入力
    if (text === null && content.some((b) => (b as RawBlockLike)?.type === "image")) text = ""
  }
  if (text === null) return false
  const trimmed = text.trimStart()
  if (trimmed.startsWith(INTERRUPT_MARK)) return false
  const origin = originOf(entry)
  if (origin === "scheduled") return true
  if (origin !== "human") return false
  return !(SYSTEM_WRAPPER.test(trimmed) || trimmed.startsWith(CONTINUATION_MARK))
}

export interface RouteContext {
  index: MapIndex
  home: string
  /** 入口の箱(entry:desktop か task:<id>) */
  entry: string
  /** グループの箱。分からなければ null */
  group: string | null
}

interface Building {
  startAt: number | null
  endAt: number | null
  calls: number
  boxes: string[]
  boxCalls: Map<string, number>
  others: Map<string, number>
  guard: number
  agents: number
}

const newBuilding = (at: number | null): Building => ({
  startAt: at,
  endAt: at,
  calls: 0,
  boxes: [],
  boxCalls: new Map(),
  others: new Map(),
  guard: 0,
  agents: 0,
})

function toMs(v: unknown): number | null {
  if (typeof v !== "string") return null
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? null : ms
}

const countsOf = (m: Map<string, number>, isBox: boolean): RouteCount[] =>
  [...m.entries()].map(([key, count]) => ({ key, isBox, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))

/**
 * 会話記録の行を順に受け取り、指示ごとのルートを作る。行は JSON を解いた物か、解かずに時刻だけを取った物(巨大な行)を渡す
 */
export class RouteBuilder {
  private readonly ctx: RouteContext
  private readonly built: Building[] = []
  private cur: Building | null = null
  /** 見た tool_use の id(1回の応答が複数の行に分かれ、同じ呼び出しが二度出ることがあるため。重なりを除く) */
  private readonly seen = new Set<string>()

  constructor(ctx: RouteContext) {
    this.ctx = ctx
  }

  /** 時刻だけを進める(解かずに飛ばした行) */
  touch(at: number | null): void {
    if (this.cur && at !== null && (this.cur.endAt === null || at > this.cur.endAt)) this.cur.endAt = at
  }

  add(entry: RawEntry): void {
    const at = toMs(entry.timestamp)
    if (startsInstruction(entry)) {
      this.cur = newBuilding(at)
      this.built.push(this.cur)
      return
    }
    this.touch(at)
    if (!this.cur || entry.isSidechain || entry.type !== "assistant") return
    const content = entry.message?.content
    if (!Array.isArray(content)) return
    for (const b of content as RawBlockLike[]) {
      if (!b || b.type !== "tool_use" || typeof b.name !== "string") continue
      if (typeof b.id === "string") {
        if (this.seen.has(b.id)) continue
        this.seen.add(b.id)
      }
      const input = b.input && typeof b.input === "object" ? (b.input as Record<string, unknown>) : {}
      const result = boxOf(b.name, input, this.ctx.index, this.ctx.home)
      if (result.kind === "skip") continue
      const cur = this.cur
      cur.calls++
      if (isGuarded(b.name) && this.ctx.index.ids.has(GUARD_BOX)) cur.guard++
      if (b.name === "Agent" || b.name === "Task") cur.agents++
      if (result.kind === "box") {
        cur.boxes.push(result.id)
        cur.boxCalls.set(result.id, (cur.boxCalls.get(result.id) ?? 0) + 1)
      } else {
        cur.others.set(result.name, (cur.others.get(result.name) ?? 0) + 1)
      }
    }
  }

  /** running:最後の指示が動いている途中か */
  finish(running: boolean): RouteInstruction[] {
    const head: RouteStep[] = [{ box: this.ctx.entry, calls: 0 }]
    if (this.ctx.group) head.push({ box: this.ctx.group, calls: 0 })
    return this.built.map((b, i) => {
      const steps: RouteStep[] = [...head]
      for (const box of b.boxes) {
        const last = steps[steps.length - 1]
        if (steps.length > head.length && last.box === box) last.calls++
        else steps.push({ box, calls: 1 })
      }
      const visits: RouteVisit[] = []
      const byBox = new Map<string, RouteVisit>()
      for (const s of steps) {
        const v = byBox.get(s.box)
        if (v) {
          v.visits++
          v.calls += s.calls
        } else {
          const nv = { box: s.box, order: visits.length + 1, calls: s.calls, visits: 1 }
          byBox.set(s.box, nv)
          visits.push(nv)
        }
      }
      const boxCounts = countsOf(b.boxCalls, true)
      const otherCounts = countsOf(b.others, false)
      const top = [...boxCounts, ...otherCounts].sort((x, y) => y.count - x.count).slice(0, 2)
      const empty: RouteEmpty = b.calls === 0 ? "no-tools" : b.boxes.length === 0 ? "no-box" : null
      return {
        index: i + 1,
        startAt: b.startAt,
        endAt: b.endAt,
        calls: b.calls,
        top,
        steps,
        visits,
        others: otherCounts,
        guard: b.guard,
        agents: b.agents,
        empty,
        running: running && i === this.built.length - 1,
      }
    })
  }
}

/** 巨大な行(これを超える行)は JSON を解かず、ツールの結果の行として時刻だけを進める */
export const MAX_PARSE_BYTES = 1024 * 1024
const TIMESTAMP = /"timestamp":"([^"]{10,40})"/

/** 会話記録の1行を RouteBuilder に渡す。壊れた行は飛ばす */
export function feedLine(builder: RouteBuilder, line: string): void {
  if (line.length > MAX_PARSE_BYTES && line.includes('"tool_result"')) {
    const m = TIMESTAMP.exec(line.slice(-2000)) ?? TIMESTAMP.exec(line.slice(0, 4000))
    builder.touch(m ? toMs(m[1]) : null)
    return
  }
  let entry: RawEntry
  try {
    entry = JSON.parse(line) as RawEntry
  } catch {
    return
  }
  if (entry && typeof entry === "object") builder.add(entry)
}

/** グループの決め方(規則2・A5b):題名が台帳の title と一致すればそれ、無ければ作業フォルダを正規化して台帳の folder と比べる */
export function groupOf(title: string, cwd: string | null, index: MapIndex, home: string): string | null {
  const t = title.trim()
  if (t) {
    const hit = index.groups.find((g) => g.title === t)
    if (hit) return hit.group
  }
  const folder = cwd ? normalizePath(cwd, home) : null
  if (folder) {
    const hit = index.groups.find((g) => g.folder !== null && g.folder === folder)
    if (hit) return hit.group
  }
  return null
}

/** 入口の箱:予定タスクは task:<id>(地図に無ければ entry:desktop) */
export function entryOf(scheduledTaskId: string | null, index: MapIndex): string {
  if (scheduledTaskId && index.ids.has(`task:${scheduledTaskId}`)) return `task:${scheduledTaskId}`
  return ENTRY_DESKTOP
}
