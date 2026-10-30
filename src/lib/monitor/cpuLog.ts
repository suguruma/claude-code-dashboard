import { promises as fs } from "fs"
import { getPreviewBlockReason } from "@/lib/sensitivePaths"
import type { AlertBand, AlertKey, LoadPoint } from "./monitorTypes"
import { parseLocalTime, parseNumber, splitLines, toRow } from "./tsv"

/**
 * CPU の記録(cpu_YYYYMMDD.tsv。■ファイル管理の記録の仕組みが約1分ごとに書く)を読む(⑭ WC-3〜WC-6・WC-11・WC-12)。読み取り専用。
 * - 列は見出しの名前で読む。見出しが7列のファイル(10/25 まで)と8列のファイル(mem_total_mb つき。10/26 から)の両方を読む(A33)
 * - 1回の記録(同じ time の行)を1つにまとめる。alert の行は位置に頼らず time で結ぶ(total の直後でも末尾でもよい。A34)
 * - しきい値は alert の行の title(「CPU 85% 以上」「メモリ 90% 以上」)から読み、ここには持たない(A13)
 * - ファイルは追記だけなので、前回の大きさから後ろだけを読み足す(A9)。小さくなったら(作り直し)最初から読む
 */

export interface SessionSample {
  id: string
  /** ファイルに書かれた題名(サイドバーの題名の写し。Desktop と結べないときに使う) */
  title: string
  cpu: number
  memMb: number | null
  procs: number | null
}

export interface ProcSample {
  name: string
  cpu: number
  memMb: number | null
}

export interface AlertSample {
  key: AlertKey
  /** title から読んだしきい値。読めないときは null(警告には数え、線は引かない) */
  threshold: number | null
  /** cpu_pct の列の値(CPU は PC 全体の %、メモリは使用率 %) */
  value: number | null
}

export interface MinuteRecord {
  t: number
  cpu: number | null
  memMb: number | null
  procs: number | null
  /** total の行の mem_total_mb(8列のファイルだけ) */
  memTotalMb: number | null
  sessions: SessionSample[]
  others: ProcSample[]
  alerts: AlertSample[]
}

const KINDS = new Set(["total", "session", "proc", "alert"])

/** title の「85%」の数字。読めなければ null */
export function thresholdOf(title: string | undefined): number | null {
  const m = /(\d+(?:\.\d+)?)\s*[%％]/.exec(title ?? "")
  return m ? Number(m[1]) : null
}

/** 読み足していく1つのファイルの状態 */
export class CpuFileState {
  header: string[] | null = null
  offset = 0
  size = 0
  /** 最後の改行の後ろの、まだ書き終わっていない行 */
  private rest = ""
  private byTime = new Map<string, MinuteRecord>()
  skipped = 0

  /** 読んだ文字を足す。final=true のときは、最後の改行の無い行も1行として読む(テスト用) */
  feed(text: string, final = false): void {
    const lines = splitLines(this.rest + text)
    this.rest = final ? "" : (lines.pop() ?? "")
    if (final && lines[lines.length - 1] === "") lines.pop()
    for (const line of lines) {
      if (this.header === null) {
        this.header = line.replace(/^﻿/, "").split("\t").map((h) => h.trim())
        continue
      }
      if (line.trim() === "") continue
      this.addRow(toRow(this.header, line))
    }
  }

  private addRow(row: Record<string, string | undefined>): void {
    const kind = row.kind?.trim() ?? ""
    const timeText = row.time?.trim() ?? ""
    const t = parseLocalTime(timeText)
    if (!KINDS.has(kind) || t === null) {
      this.skipped++
      return
    }
    const rec = this.byTime.get(timeText) ?? { t, cpu: null, memMb: null, procs: null, memTotalMb: null, sessions: [], others: [], alerts: [] }
    const cpu = parseNumber(row.cpu_pct)
    const mem = parseNumber(row.mem_mb)
    const procs = parseNumber(row.procs)
    const key = row.key?.trim() ?? ""
    switch (kind) {
      case "total":
        if (cpu === null) {
          this.skipped++
          return
        }
        rec.cpu = cpu
        rec.memMb = mem
        rec.procs = procs
        rec.memTotalMb = parseNumber(row.mem_total_mb)
        break
      case "session":
        if (cpu === null || !key) {
          this.skipped++
          return
        }
        rec.sessions.push({ id: key, title: (row.title ?? "").trim(), cpu, memMb: mem, procs })
        break
      case "proc":
        if (cpu === null || !key) {
          this.skipped++
          return
        }
        rec.others.push({ name: key, cpu, memMb: mem })
        break
      case "alert": {
        // key=high は CPU、key=mem はメモリ。ほかの key は数えない(A18)
        if (key !== "high" && key !== "mem") {
          this.skipped++
          return
        }
        rec.alerts.push({ key: key === "high" ? "cpu" : "mem", threshold: thresholdOf(row.title), value: cpu })
        break
      }
    }
    this.byTime.set(timeText, rec)
  }

  records(): MinuteRecord[] {
    return [...this.byTime.values()].filter((r) => r.cpu !== null || r.alerts.length > 0 || r.sessions.length > 0).sort((a, b) => a.t - b.t)
  }
}

/** 1つの CPU の記録のファイルを、前回の続きから読み足す。拒否リストに当たる場所は開かない */
export async function readCpuFile(filePath: string, state: CpuFileState | undefined): Promise<{ status: "ok" | "missing" | "refused" | "unreadable"; state: CpuFileState }> {
  let s = state ?? new CpuFileState()
  if (getPreviewBlockReason(filePath)) return { status: "refused", state: s }
  let handle: fs.FileHandle | null = null
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return { status: "unreadable", state: s }
    if (stat.size < s.offset) s = new CpuFileState()
    if (stat.size === s.offset) return { status: "ok", state: s }
    handle = await fs.open(filePath, "r")
    const length = stat.size - s.offset
    const buf = Buffer.alloc(length)
    await handle.read(buf, 0, length, s.offset)
    // 途中で切れた UTF-8 の文字を残さないよう、最後の改行までを使う
    const lastNl = buf.lastIndexOf(0x0a)
    const usable = lastNl >= 0 ? lastNl + 1 : 0
    if (usable > 0) {
      s.feed(buf.subarray(0, usable).toString("utf-8"))
      s.offset += usable
    }
    s.size = stat.size
    return { status: "ok", state: s }
  } catch (e) {
    return { status: (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable", state: s }
  } finally {
    await handle?.close()
  }
}

/** 記録の途切れ：前の total の記録から3分を超えて空いた所(A5) */
export const GAP_MS = 3 * 60_000

export function findGaps(points: ReadonlyArray<{ t: number }>, until: number | null): Array<{ start: number; end: number }> {
  const gaps: Array<{ start: number; end: number }> = []
  for (let i = 1; i < points.length; i++) {
    if (points[i].t - points[i - 1].t > GAP_MS) gaps.push({ start: points[i - 1].t, end: points[i].t })
  }
  // 今日を見ているときは、最後の記録から今までの空きも途切れ(記録の仕組みが止まった)
  const last = points[points.length - 1]
  if (until !== null && last && until - last.t > GAP_MS) gaps.push({ start: last.t, end: until })
  return gaps
}

/** 続いた alert の行(間が3分以内)を1つの帯にまとめる(A3)。開始・終了は alert の行の時刻、最大は alert の行の値 */
export function alertBands(records: ReadonlyArray<MinuteRecord>, key: AlertKey): AlertBand[] {
  const bands: AlertBand[] = []
  for (const r of records) {
    for (const a of r.alerts) {
      if (a.key !== key) continue
      const last = bands[bands.length - 1]
      if (last && r.t - last.end <= GAP_MS) {
        last.end = r.t
        if (a.value !== null && (last.max === null || a.value > last.max)) {
          last.max = a.value
          last.peakAt = r.t
        }
        if (a.threshold !== null) last.threshold = a.threshold
      } else {
        bands.push({ start: r.t, end: r.t, max: a.value, peakAt: r.t, threshold: a.threshold })
      }
    }
  }
  return bands
}

export function toPoints(records: ReadonlyArray<MinuteRecord>): LoadPoint[] {
  return records.filter((r) => r.cpu !== null).map((r) => ({ t: r.t, cpu: r.cpu!, memMb: r.memMb, procs: r.procs }))
}
