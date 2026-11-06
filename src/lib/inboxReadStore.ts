import path from "path"
import { InvalidInputError } from "./errors"
import { getAppDataRoot, readJsonFile, writeJsonFile } from "./fileIO"
import { markRead, markUnread, parseReadTargets, pruneReads, type InboxReadData } from "./inbox"

/**
 * 知らせの既読の記録(⑮ OR-4・A8)。置き場は config/inbox-read.json(アプリのデータの置き場。git には入れない)。
 * 中身は「見た時刻・対象の ID・知らせの種類」だけ(題名・本文は持たない)。30日より前は書くたびに消す。
 * 書き込みは1本ずつ順に流す。
 */
export function inboxReadPath(): string {
  return path.join(getAppDataRoot(), "config", "inbox-read.json")
}

/** 形の違う入力(API では 400) */
export class InvalidInboxReadError extends InvalidInputError {}

interface StoreOptions {
  filePath?: () => string
  now?: () => number
}

export class InboxReadStore {
  private readonly filePath: () => string
  private readonly now: () => number
  private writing: Promise<void> = Promise.resolve()

  constructor(options: StoreOptions = {}) {
    this.filePath = options.filePath ?? inboxReadPath
    this.now = options.now ?? Date.now
  }

  async get(): Promise<InboxReadData> {
    await this.writing
    return this.readFile()
  }

  /** 書き込みの列の中からも読むので、列を待たない */
  private async readFile(): Promise<InboxReadData> {
    try {
      const raw = await readJsonFile<Partial<InboxReadData>>(this.filePath(), { reads: [] })
      return { reads: pruneReads(raw?.reads, this.now()) }
    } catch {
      // 壊れているときは、既読なしとして読み、次の書き込みで作り直す
      return { reads: [] }
    }
  }

  /** 既読にする({ items: [{ target, kind }] })。unread: true なら未読に戻す */
  update(input: unknown): Promise<InboxReadData> {
    const targets = parseReadTargets(input)
    if (!targets) return Promise.reject(new InvalidInboxReadError("items は { target, kind } の 200 件までの配列で指定してください"))
    const unread = (input as { unread?: unknown }).unread === true
    const run = this.writing.then(async () => {
      const { reads } = await this.readFile()
      const next: InboxReadData = { reads: unread ? markUnread(reads, targets) : markRead(reads, targets, this.now()) }
      await writeJsonFile(this.filePath(), next)
      return next
    })
    this.writing = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
}

/** サーバーのプロセスに1つ(Next の開発サーバーの作り直しでも1つに保つ) */
const globalStore = globalThis as unknown as { __ccdInboxReadStore?: InboxReadStore }
export function getInboxReadStore(): InboxReadStore {
  globalStore.__ccdInboxReadStore ??= new InboxReadStore()
  return globalStore.__ccdInboxReadStore
}
