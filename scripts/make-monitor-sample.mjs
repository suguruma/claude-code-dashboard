/**
 * リソースのページ（⑭）の動作確認・撮影用に、合成（架空）の見張りの記録を作る。実際の題名・ID・作業の文面は含まない。
 * 現在時刻を基準に作るので、画面を開く直前に実行する（古くなったら作り直す）。
 *
 * 使い方:
 *   node scripts/make-monitor-sample.mjs <出力先のフォルダ> [--no-alert] [--today-cols 7]
 * 出力先に work_plan.tsv・resume_queue.tsv・cpu/cpu_<昨日>.tsv・cpu/cpu_<今日>.tsv ができる。
 * 読む場所を config/monitor.json に書いて（{ "workPlanFile": …, "resumeQueueFile": …, "cpuDir": … }）サーバーを起動する。
 *
 * 作るもの:
 *   作業計画: 2グループ・セッション7。作業中・これから・後で・済み・待ち行列にいる作業中（「待ち（上限）」になる）・
 *            列の足りない行1・CRLF と LF の混ざり
 *   待ち行列: 待っているセッション2（回復は1時間20分後と3時間後）・再開した1・起こした1
 *   CPU の記録: 昨日（見出し7列。■ファイル管理が 10/25 13:10 に形を変える前の形）と今日（見出し8列。mem_total_mb つき）。
 *            1分ごと・セッション25（組織図の合成データの7つ〈題名は Desktop から〉と、Desktop に無い18〈題名はファイルから〉）・
 *            セッションの外のプログラム（上位3つ）・今日の2時間前に CPU の警告（6分）とメモリの警告（4分）・
 *            今日の4時間前に記録の途切れ（25分。PC の再起動の形）。--no-alert で警告を作らない。
 *            --today-cols 7 で、今日のファイルも7列にする（総量の列が無い日の確認用）
 * 組織図の合成データ（make-org-chart-sample.mjs）と同じセッション ID を使うので、両方を作ると Desktop の題名と結べる。
 */
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const args = process.argv.slice(2)
const noAlert = args.includes("--no-alert")
const colsArg = args.indexOf("--today-cols")
const todayCols = colsArg >= 0 ? Number(args[colsArg + 1]) : 8
const out = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--today-cols")
if (!out) {
  console.error("使い方: node scripts/make-monitor-sample.mjs <出力先のフォルダ> [--no-alert] [--today-cols 7]")
  process.exit(2)
}

const MIN = 60_000
const sid = (n) => `local_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const pad = (n) => String(n).padStart(2, "0")
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const stamp = (t, sec = true) => {
  const d = new Date(t)
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return sec ? `${base}:${pad(d.getSeconds())}` : base
}

// 決まった乱数(実行のたびに同じ形になるように)
let seed = 20261025
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

const now = Date.now()
const GROUP_A = "試験グループ"
const GROUP_B = "別グループ"

// ---- 作業計画と待ち行列 ----
const plan = [
  "date\tsession\tgroup\ttask\tsize\tresume\torder\tstate",
  [stamp(now - 300 * MIN, false), sid(102), GROUP_A, "一覧の表の直し", "中", "易", "1", "todo"].join("\t"),
  [stamp(now - 240 * MIN, false), sid(102), GROUP_A, "一覧の表の直し", "中", "易", "1", "doing"].join("\t") + "\r",
  [stamp(now - 230 * MIN, false), sid(103), GROUP_A, "週の集計の作成", "大", "易", "2", "doing"].join("\t"),
  [stamp(now - 220 * MIN, false), sid(104), GROUP_A, "画面の独立した確認", "小", "易", "3", "todo"].join("\t") + "\r",
  [stamp(now - 210 * MIN, false), sid(105), GROUP_A, "手引きの書き直し", "中", "難", "4", "later"].join("\t"),
  [stamp(now - 200 * MIN, false), sid(105), GROUP_A, "用語の表の整理", "小", "易", "1", "done"].join("\t"),
  [stamp(now - 190 * MIN, false), sid(202), GROUP_B, "資料の下調べ", "中", "易", "1", "doing"].join("\t"),
  [stamp(now - 180 * MIN, false), sid(202), GROUP_B, "前の下調べ", "小", "易", "1", "done"].join("\t"),
  [stamp(now - 170 * MIN, false), sid(201), GROUP_B, "次の週の計画", "小", "易", "2", "todo"].join("\t"),
  [stamp(now - 160 * MIN, false), sid(103), GROUP_A, "列の足りない行", "小"].join("\t"),
  "",
].join("\n")

const resetA = new Date(now + 80 * MIN).toISOString().replace(/\.\d{3}Z$/, "Z")
const resetB = new Date(now + 180 * MIN).toISOString().replace(/\.\d{3}Z$/, "Z")
const queue = [
  "date\tsession\tgroup\tresets_at\tstate\tnext",
  [stamp(now - 120 * MIN, false), sid(103), GROUP_A, resetA, "wait", "週の集計の残りの2表を作る"].join("\t"),
  [stamp(now - 110 * MIN, false), sid(202), GROUP_B, resetB, "wait", "下調べのまとめを台帳に書く"].join("\t"),
  [stamp(now - 100 * MIN, false), sid(104), GROUP_A, "", "wait", "確認の続き"].join("\t"),
  [stamp(now - 60 * MIN, false), sid(104), GROUP_A, "", "sent", ""].join("\t"),
  [stamp(now - 50 * MIN, false), sid(104), GROUP_A, "", "resumed", ""].join("\t"),
  "",
].join("\n")

// ---- CPU の記録 ----
// 組織図の合成データと同じ ID・題名(Desktop と結べないときも、ファイルの題名で同じ名前が出る)
const DESKTOP = [
  [101, "00_リーダー_試験", 6],
  [102, "01_画面の修正", 18],
  [103, "02_集計の作成", 14],
  [104, "03_検証", 4],
  [105, "04_文書の整備", 5],
  [201, "00_リーダー_別", 3],
  [202, "01_調査", 9],
]
const SESSIONS = [
  ...DESKTOP.map(([n, title, weight]) => ({ id: sid(n), title, weight })),
  ...Array.from({ length: 18 }, (_, i) => ({ id: sid(400 + i), title: `担当_試験${pad(i + 1)}`, weight: Math.max(0.3, 4 - i * 0.2) })),
]
const PROCS = ["claude", "node", "MsMpEng", "explorer"]
const TOTAL_MB = 32768

const startToday = new Date(now).setHours(0, 0, 0, 0)
const startYesterday = startToday - 24 * 60 * MIN
const alertStart = now - 120 * MIN
const gapStart = now - 240 * MIN
const gapEnd = gapStart + 25 * MIN

function minuteRows(t, cols) {
  const inAlert = !noAlert && t >= alertStart && t < alertStart + 6 * MIN
  const inMemAlert = !noAlert && t >= alertStart + 2 * MIN && t < alertStart + 6 * MIN
  const total = inAlert ? 86 + rand() * 7 : 3 + rand() * 10 + (Math.sin(t / (90 * MIN)) + 1) * 3
  const memMb = inMemAlert ? TOTAL_MB * (0.905 + rand() * 0.02) : 19500 + rand() * 2500 + (Math.sin(t / (180 * MIN)) + 1) * 600
  const tail = (cells) => (cols === 8 ? [...cells, ""] : cells).join("\t")
  const rows = []
  const totalCells = [stamp(t), "total", "all", "", total.toFixed(1), memMb.toFixed(0), String(180 + Math.floor(rand() * 20))]
  rows.push(cols === 8 ? [...totalCells, String(TOTAL_MB)].join("\t") : totalCells.join("\t"))
  if (inAlert) rows.push(tail([stamp(t), "alert", "high", "CPU 85% 以上", total.toFixed(1), "", ""]))
  if (inMemAlert) rows.push(tail([stamp(t), "alert", "mem", "メモリ 90% 以上", ((memMb / TOTAL_MB) * 100).toFixed(1), "", ""]))
  const weights = SESSIONS.map((s) => s.weight * (0.6 + rand() * 0.8))
  const sum = weights.reduce((a, b) => a + b, 0)
  SESSIONS.forEach((s, i) => {
    const cpu = (total * 0.72 * weights[i]) / sum
    const mem = 150 + s.weight * 45 + rand() * 80
    rows.push(tail([stamp(t), "session", s.id, s.title, cpu.toFixed(2), mem.toFixed(0), String(1 + (i % 4))]))
  })
  // セッションの外(上位3つ)
  PROCS.slice(0, 3).forEach((name, i) => {
    const cpu = [total * 0.12, 1 + rand() * 1.5, 1 + rand()][i]
    rows.push(tail([stamp(t), "proc", name, "", cpu.toFixed(2), (300 + rand() * 400).toFixed(0), "1"]))
  })
  return rows
}

function cpuFile(from, to, cols) {
  const head = ["time", "kind", "key", "title", "cpu_pct", "mem_mb", "procs", ...(cols === 8 ? ["mem_total_mb"] : [])].join("\t")
  const lines = [head]
  for (let t = from; t < to; t += MIN) {
    if (t >= gapStart && t < gapEnd) continue
    lines.push(...minuteRows(t + 19_000, cols))
  }
  return lines.join("\n") + "\n"
}

await mkdir(path.join(out, "cpu"), { recursive: true })
await writeFile(path.join(out, "work_plan.tsv"), plan, "utf-8")
await writeFile(path.join(out, "resume_queue.tsv"), queue, "utf-8")
await writeFile(path.join(out, "cpu", `cpu_${ymd(new Date(startYesterday))}.tsv`), cpuFile(startYesterday, startToday, 7), "utf-8")
await writeFile(path.join(out, "cpu", `cpu_${ymd(new Date(startToday))}.tsv`), cpuFile(startToday, Math.floor(now / MIN) * MIN, todayCols), "utf-8")
console.log(`合成の見張りの記録を作りました: ${path.resolve(out)}`)
