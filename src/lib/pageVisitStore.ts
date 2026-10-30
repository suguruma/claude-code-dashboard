import path from "path"
import { InvalidInputError } from "./errors"
import { getAppDataRoot, readJsonFile, writeJsonFile } from "./fileIO"
import {
  PAGE_VISIT_WRITE_INTERVAL_MS,
  daysAgoKey,
  isPageVisitPath,
  localDateKey,
  prunePageVisits,
  type PageVisitsData,
} from "./pageVisits"

/**
 * ページを開いた回数の保存(⑬ FS-7)。置き場は config/page-visits.json(アプリのデータの置き場。git には入れない)。
 * 受け取った回数はメモリにためて、ファイルへは1分に1回までまとめて書く。
 * 同じ日・同じパスは、このプロセスの中では1回しか数えない(画面の記録が消えても、開くたびに増えないように)。
 * オフのあいだは何も数えない。
 */
export function pageVisitsPath(): string {
  return path.join(getAppDataRoot(), "config", "page-visits.json")
}

/** 形の違う入力(API では 400) */
export class InvalidPageVisitsError extends InvalidInputError {}

interface StoreOptions {
  filePath?: () => string
  now?: () => number
  writeIntervalMs?: number
  /** 書き込みを後に回すときの時計(試験で差し替える) */
  schedule?: (fn: () => void, ms: number) => void
}

export class PageVisitStore {
  private readonly filePath: () => string
  private readonly now: () => number
  private readonly writeIntervalMs: number
  private readonly schedule: (fn: () => void, ms: number) => void
  private pending = new Map<string, number>()
  private seen = new Set<string>()
  private lastWriteAt = Number.NEGATIVE_INFINITY
  private flushScheduled = false
  private writing: Promise<void> = Promise.resolve()

  constructor(options: StoreOptions = {}) {
    this.filePath = options.filePath ?? pageVisitsPath
    this.now = options.now ?? Date.now
    this.writeIntervalMs = options.writeIntervalMs ?? PAGE_VISIT_WRITE_INTERVAL_MS
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms)
        timer.unref?.()
      })
  }

  private async readFile(): Promise<PageVisitsData> {
    try {
      const raw = await readJsonFile<Partial<PageVisitsData>>(this.filePath(), { enabled: true, visits: {} })
      return {
        enabled: raw?.enabled !== false,
        visits: prunePageVisits((raw?.visits as PageVisitsData["visits"]) ?? {}, this.now()),
      }
    } catch {
      // 壊れているときは、オン・回数なしとして読み、次の書き込みで作り直す
      return { enabled: true, visits: {} }
    }
  }

  /** 保存した回数に、まだ書いていない回数を足して返す */
  async get(): Promise<PageVisitsData> {
    await this.writing
    const data = await this.readFile()
    for (const [key, count] of this.pending) {
      const [p, date] = key.split("|")
      data.visits[p] = { ...data.visits[p], [date]: (data.visits[p]?.[date] ?? 0) + count }
    }
    return { enabled: data.enabled, visits: prunePageVisits(data.visits, this.now()) }
  }

  /**
   * 画面から届いた「開いた」を数える。13ページの表に無いパス・形の違う日付・昨日より前と明日より後の日付は数えない。
   * 戻り値は数えた件数。
   */
  async record(input: unknown): Promise<number> {
    const items = (input as { visits?: unknown } | null)?.visits
    if (!Array.isArray(items) || items.length > 50) {
      throw new InvalidPageVisitsError("visits は 50 件までの配列で指定してください")
    }
    const { enabled } = await this.readFile()
    if (!enabled) return 0
    const now = this.now()
    const allowed = new Set([daysAgoKey(now, 1), localDateKey(now), daysAgoKey(now, -1)])
    let accepted = 0
    for (const item of items) {
      const p = (item as { path?: unknown })?.path
      const date = (item as { date?: unknown })?.date
      if (!isPageVisitPath(p) || typeof date !== "string" || !allowed.has(date)) continue
      const key = `${p}|${date}`
      if (this.seen.has(key)) continue
      this.seen.add(key)
      this.pending.set(key, (this.pending.get(key) ?? 0) + 1)
      accepted += 1
    }
    if (accepted > 0) this.requestFlush()
    return accepted
  }

  private requestFlush() {
    if (this.flushScheduled) return
    const wait = this.lastWriteAt + this.writeIntervalMs - this.now()
    if (wait <= 0) {
      this.flush().catch(() => undefined)
      return
    }
    this.flushScheduled = true
    this.schedule(() => {
      this.flushScheduled = false
      this.flush().catch(() => undefined)
    }, wait)
  }

  /** 書き込みを1本ずつ順に流す(前の書き込みが失敗しても、後の書き込みは止めない) */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writing.then(fn)
    this.writing = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /** ためた回数をファイルへ書く(試験と、オン・オフの保存のときにも使う)。書けなかった分はためた所へ戻す */
  flush(): Promise<void> {
    return this.serial(async () => {
      if (this.pending.size === 0) return
      const batch = new Map(this.pending)
      this.pending.clear()
      this.lastWriteAt = this.now()
      try {
        const data = await this.readFile()
        for (const [key, count] of batch) {
          const [p, date] = key.split("|")
          data.visits[p] = { ...data.visits[p], [date]: (data.visits[p]?.[date] ?? 0) + count }
        }
        await writeJsonFile(this.filePath(), { enabled: data.enabled, visits: prunePageVisits(data.visits, this.now()) })
      } catch (err) {
        for (const [key, count] of batch) this.pending.set(key, (this.pending.get(key) ?? 0) + count)
        throw err
      }
    })
  }

  /** 数える・数えないの切り替え。オフにする前に届いていた回数は書いてから切り替える(数えた結果は消さない) */
  async setEnabled(input: unknown): Promise<PageVisitsData> {
    const enabled = (input as { enabled?: unknown } | null)?.enabled
    if (typeof enabled !== "boolean") {
      throw new InvalidPageVisitsError("enabled は true または false で指定してください")
    }
    await this.flush()
    return this.serial(async () => {
      const next: PageVisitsData = { enabled, visits: (await this.readFile()).visits }
      await writeJsonFile(this.filePath(), next)
      return next
    })
  }
}

/** サーバーのプロセスに1つ(Next の開発サーバーの作り直しでも1つに保つ) */
const globalStore = globalThis as unknown as { __ccdPageVisitStore?: PageVisitStore }
export function getPageVisitStore(): PageVisitStore {
  globalStore.__ccdPageVisitStore ??= new PageVisitStore()
  return globalStore.__ccdPageVisitStore
}
