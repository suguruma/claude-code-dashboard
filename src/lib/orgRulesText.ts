import { parseClaudeMd } from "./claudeMdParser"
import type { OrgRuleSection, StaleRef } from "./orgRulesTypes"

/**
 * 組織のルールのページ(⑨)の、ファイルを読まない純粋な処理。
 * 節への分け方・先頭に出す節の並べ替え・古いセッション名の判定・記憶の索引の読み方。
 */

/** 比べる相手の題名。live: アーカイブされていないセッション / archived: アーカイブ済みのセッション */
export interface SessionTitles {
  live: string[]
  archived: string[]
}

/** 「2桁の数字＋_」で始まる語。前が英数字・_ のもの(ファイル名の途中など)は除く */
const REF_RE = /(?<![0-9A-Za-z_])(\d{2})_([^\s「」『』（）()、。,，:：*`|[\]<>＜＞"'“”]*)/g
/** 語の続き(空白を含む題名)を読むときに、そこで止める文字 */
const EXT_STOP = /[「」『』（）()、。,，:：*`|[\]<>＜＞"'“”\n]/
const EXT_MAX = 60
const HINT_MAX = 3

const squash = (s: string) => s.replace(/\s+/g, "")

/**
 * 本文の中の「NN_題名」を取り出し、今のセッションの題名と比べて、合わないものを返す(Q6)。
 * - 空白を除いて比べ、題名が語の続きの先頭と一致する、または語が題名の先頭と一致すれば「合う」
 *   (例: 題名「05_ClaudeCodeDashboard」と、本文の「05_Claude Code Dashboard の担当」は合う)
 * - アーカイブ済みの題名とだけ合うものは archived、どれとも合わなければ mismatch
 * - 雛形・例の書き方は対象にしない: 直後が `<`・`…`・`...` のもの、名前が空・`…` だけ・数字だけのもの
 */
export function findStaleRefs(text: string, titles: SessionTitles): StaleRef[] {
  const live = titles.live.map(squash)
  const archived = titles.archived.map(squash)
  const found = new Map<string, StaleRef>()
  for (const m of text.matchAll(REF_RE)) {
    const [whole, num, name] = m
    const start = m.index ?? 0
    const after = text.slice(start + whole.length)
    if (!name || /^[.…‥・]+$/.test(name) || /^\d+$/.test(name)) continue
    if (/^(<|＜|…|\.\.\.)/.test(after)) continue

    const token = `${num}_${name}`
    let ext = text.slice(start, start + EXT_MAX)
    const stop = ext.search(EXT_STOP)
    if (stop > 0) ext = ext.slice(0, stop)
    const extNorm = squash(ext)
    const matches = (t: string) => extNorm.startsWith(t) || t.startsWith(token)
    if (live.some(matches)) continue

    const kind: StaleRef["kind"] = archived.some(matches) ? "archived" : "mismatch"
    const extName = extNorm.slice(num.length + 1)
    const sameNumber = titles.live.filter((t) => squash(t).startsWith(`${num}_`)).slice(0, HINT_MAX)
    const sameName = titles.live
      .filter((t) => {
        const tn = squash(t)
        if (tn.startsWith(`${num}_`) || !/^\d{2}_/.test(tn)) return false
        const tName = tn.slice(3)
        return tName.length >= 2 && (extName.startsWith(tName) || tName.startsWith(name))
      })
      .slice(0, HINT_MAX)
    if (!found.has(token)) found.set(token, { text: token, kind, sameNumber, sameName })
  }
  return [...found.values()]
}

/** CLAUDE.md を `## 見出し` ごとの節に分ける(ルール管理と同じ parseClaudeMd。無効の節は enabled: false) */
export function claudeMdSections(content: string, titles: SessionTitles | null): { preamble: string; sections: OrgRuleSection[] } {
  const parsed = parseClaudeMd(content.replace(/\r\n/g, "\n"))
  return {
    preamble: parsed.preamble,
    sections: parsed.rules.map((r) => ({
      title: r.category,
      enabled: r.enabled,
      body: r.content,
      staleRefs: titles ? findStaleRefs(`${r.category}\n${r.content}`, titles) : [],
    })),
  }
}

/** 追加のファイル(.md)を、見出し(`#`〜`###`)ごとの節に分ける。見出しより前は preamble */
export function markdownSections(content: string, titles: SessionTitles | null): { preamble: string; sections: OrgRuleSection[] } {
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  const preamble: string[] = []
  const sections: Array<{ title: string; lines: string[] }> = []
  for (const line of lines) {
    const h = /^#{1,3}\s+(.*)$/.exec(line)
    if (h) sections.push({ title: h[1].trim(), lines: [] })
    else if (sections.length > 0) sections[sections.length - 1].lines.push(line)
    else preamble.push(line)
  }
  return {
    preamble: preamble.join("\n").trim(),
    sections: sections.map((s) => {
      const body = s.lines.join("\n").trim()
      return { title: s.title, enabled: true, body, staleRefs: titles ? findStaleRefs(`${s.title}\n${body}`, titles) : [] }
    }),
  }
}

/** 既定で先頭に出す節(見出しの前方一致。この順に出す) */
export const DEFAULT_PINNED_SECTIONS = ["組織の運用", "セッションの題名"]

/** 先頭に出す節を、指定の順で前に出す。残りはファイルの順。前に出した節には pinned: true を付ける */
export function pinSections<T extends { title: string }>(sections: T[], pins: string[]): Array<T & { pinned: boolean }> {
  const picked: T[] = []
  for (const pin of pins) {
    const hit = sections.find((s) => !picked.includes(s) && s.title.startsWith(pin))
    if (hit) picked.push(hit)
  }
  return [
    ...picked.map((s) => ({ ...s, pinned: true })),
    ...sections.filter((s) => !picked.includes(s)).map((s) => ({ ...s, pinned: false })),
  ]
}

/** MEMORY.md(索引)から、リンク先の .md のファイル名を取り出す */
export function memoryIndexTargets(index: string): Set<string> {
  const names = new Set<string>()
  for (const m of index.matchAll(/\]\(([^)\s]+)\)/g)) {
    let target = m[1]
    try {
      target = decodeURIComponent(target)
    } catch {
      // そのまま使う
    }
    const base = target.split(/[\\/]/).pop() ?? ""
    if (base.toLowerCase().endsWith(".md")) names.add(base)
  }
  return names
}
