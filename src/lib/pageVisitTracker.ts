import { PAGE_VISIT_WRITE_INTERVAL_MS, isPageVisitPath, localDateKey, type PageVisitItem } from "./pageVisits"

/**
 * 画面の側の「開いた」の記録(⑬ FS-7)。同じ日・同じパスは1回だけ送り、送るのは1分に1回までまとめて。
 * 送った印は localStorage に置く(使えないときはメモリだけ。そのときもサーバーが同じ日・同じパスを1回にまとめる)。
 */
export const PAGE_VISIT_SENT_KEY = "ccd.pageVisits.sent"

interface SentMark {
  date: string
  paths: string[]
}

export interface PageVisitTrackerDeps {
  now: () => number
  send: (items: PageVisitItem[]) => Promise<void>
  schedule: (fn: () => void, ms: number) => void
  storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } | null
}

export class PageVisitTracker {
  private queue: PageVisitItem[] = []
  private memoryMark: SentMark = { date: "", paths: [] }
  private lastSendAt = Number.NEGATIVE_INFINITY
  private sendScheduled = false
  private sending = false

  constructor(private readonly deps: PageVisitTrackerDeps) {}

  private readMark(today: string): SentMark {
    let mark = this.memoryMark
    try {
      const raw = this.deps.storage?.getItem(PAGE_VISIT_SENT_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SentMark>
        if (typeof parsed.date === "string" && Array.isArray(parsed.paths)) {
          mark = { date: parsed.date, paths: parsed.paths.filter((p) => typeof p === "string") }
        }
      }
    } catch {
      // 読めないときはメモリの印だけを使う
    }
    return mark.date === today ? mark : { date: today, paths: [] }
  }

  private writeMark(mark: SentMark) {
    this.memoryMark = mark
    try {
      this.deps.storage?.setItem(PAGE_VISIT_SENT_KEY, JSON.stringify(mark))
    } catch {
      // 書けないときはメモリの印だけ
    }
  }

  /** ページを開いたときに呼ぶ。数えるページで、今日まだ送っていなければ、送る列に足す */
  visit(path: string) {
    if (!isPageVisitPath(path)) return
    const today = localDateKey(this.deps.now())
    const mark = this.readMark(today)
    if (mark.paths.includes(path)) return
    if (this.queue.some((q) => q.path === path && q.date === today)) return
    this.queue.push({ path, date: today })
    this.requestSend()
  }

  private requestSend() {
    if (this.sendScheduled || this.sending) return
    const wait = this.lastSendAt + PAGE_VISIT_WRITE_INTERVAL_MS - this.deps.now()
    if (wait <= 0) {
      void this.flush()
      return
    }
    this.sendScheduled = true
    this.deps.schedule(() => {
      this.sendScheduled = false
      void this.flush()
    }, wait)
  }

  /** 列にたまった分を送る。送れたら印を付け、送れなかったら列に戻して次の機会に送る */
  async flush() {
    if (this.queue.length === 0 || this.sending) return
    const batch = this.queue.splice(0)
    this.sending = true
    this.lastSendAt = this.deps.now()
    try {
      await this.deps.send(batch)
      const today = localDateKey(this.deps.now())
      const mark = this.readMark(today)
      const paths = new Set(mark.paths)
      for (const item of batch) if (item.date === today) paths.add(item.path)
      this.writeMark({ date: today, paths: [...paths] })
    } catch {
      this.queue.unshift(...batch)
    } finally {
      this.sending = false
    }
    if (this.queue.length > 0) this.requestSend()
  }
}
