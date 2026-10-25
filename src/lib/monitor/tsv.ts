/**
 * 見張りの記録(作業計画・待ち行列・CPU の記録。⑭)のタブ区切りを読む。読み取り専用。
 * 列は見出しの行の名前で読む(列の順が変わっても読める。見出しに無い列は読まない)。
 * 行の終わりの CRLF と LF の混ざりは、どちらも1行の終わりとして扱う(要件メモ 14 の 3-2)。
 */

export interface TsvTable {
  /** 見出しの列の名前(前後の空白を落としたもの) */
  header: string[]
  /** 見出しの次の行から。列の名前 → 値。見出しより短い行は、足りない列が undefined */
  rows: Array<Record<string, string | undefined>>
  /** 空の行の数(数えるだけ) */
  blank: number
}

export function splitLines(text: string): string[] {
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
}

export function parseTsv(text: string): TsvTable {
  const lines = splitLines(text.replace(/^﻿/, ""))
  const header = (lines[0] ?? "").split("\t").map((h) => h.trim())
  const rows: TsvTable["rows"] = []
  let blank = 0
  for (const line of lines.slice(1)) {
    if (line.trim() === "") {
      blank++
      continue
    }
    rows.push(toRow(header, line))
  }
  // 最後の改行のあとの空の1行は数えない
  if (lines.length > 1 && lines[lines.length - 1] === "") blank--
  return { header, rows, blank: Math.max(0, blank) }
}

export function toRow(header: string[], line: string): Record<string, string | undefined> {
  const cells = line.split("\t")
  const row: Record<string, string | undefined> = {}
  header.forEach((name, i) => {
    if (name) row[name] = cells[i]
  })
  return row
}

/** 決まった列がすべて値を持つか(空の文字は持つとみなす。列そのものが無い行は false) */
export function hasColumns(row: Record<string, string | undefined>, names: readonly string[]): boolean {
  return names.every((n) => row[n] !== undefined)
}

/** 「2026-10-24 06:12」「2026-10-24T00:30:00Z」を epoch ms に。時差の無い形は、この PC の時刻として読む。読めなければ null */
export function parseLocalTime(value: string | undefined): number | null {
  const v = value?.trim()
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v)
  if (m) {
    const [, y, mo, d, h, mi, s] = m
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0)).getTime()
  }
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/** 数の値を読む。桁区切りのコンマ(「20,751」)は落とす。空・数でないときは null */
export function parseNumber(value: string | undefined): number | null {
  const v = value?.trim().replace(/,/g, "")
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
