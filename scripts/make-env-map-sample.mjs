/**
 * 全体マップ（組織の［全体マップ］のタブ）の動作確認用に、合成（架空）の地図 map.json と、会話ログへの道具の呼び出しの行を作る。
 * 実際の箱の名前・置き場・会話の文面は含まない。先に scripts/make-org-chart-sample.mjs で合成の Desktop のデータを作ってから流す。
 *
 * 使い方:
 *   node scripts/make-env-map-sample.mjs <make-org-chart-sample の出力先>          （地図: 7層・箱105〈うち理想の箱11〉・線69〈うち食い違い1〉）
 *   node scripts/make-env-map-sample.mjs --big <出力先>                           （地図: 箱200・線400。全体を表示の確認用）
 *   node scripts/make-env-map-sample.mjs --stale <出力先>                         （地図の作成を10日前にする。古い地図の表示の確認用）
 * 出力先の env-map/map.json に地図を書き、projects/ の各会話ログ（サブエージェントを除く）の末尾に、人の指示1つと道具の呼び出しを足す。
 * 表示するには、config/env-map.json に {"mapPath": "<出力先>\\env-map\\map.json"} を書く。
 */
import { access, appendFile, mkdir, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const args = process.argv.slice(2)
const big = args.includes("--big")
const stale = args.includes("--stale")
const outDir = args.filter((a) => !a.startsWith("--"))[0]
if (!outDir) {
  console.error("使い方: node scripts/make-env-map-sample.mjs [--big] [--stale] <出力先>")
  process.exit(1)
}

// 本物の会話記録に書き足さない:ホームの .claude の下は拒み、make-org-chart-sample が置く expected.json が無ければ止める
const resolved = path.resolve(outDir).toLowerCase()
if (resolved.startsWith(path.join(os.homedir(), ".claude").toLowerCase())) {
  console.error("ホームの .claude の下には書きません。make-org-chart-sample.mjs の出力先を渡してください")
  process.exit(1)
}
try {
  await access(path.join(outDir, "expected.json"))
} catch {
  console.error("出力先に expected.json がありません。先に make-org-chart-sample.mjs で合成のデータを作ってください")
  process.exit(1)
}

const LAYERS = [
  { id: "entry", label: "入口" },
  { id: "safety", label: "安全の仕組み" },
  { id: "routing", label: "振り分け" },
  { id: "skills", label: "スキルと役" },
  { id: "tools", label: "道具とつなぎ先" },
  { id: "knowledge", label: "知識の置き場" },
  { id: "output", label: "出口" },
]
const docsDir = path.join(path.resolve(outDir), "work", "docs")

/** 名前の決まった箱(ルートの規則で写る先) */
const FIXED = [
  { id: "entry:desktop", layer: "entry", label: "デスクトップアプリ" },
  { id: "entry:phone", layer: "entry", label: "スマホ" },
  { id: "safety:deny", layer: "safety", label: "禁止の一覧 20件", strength: "stop" },
  { id: "safety:auto", layer: "safety", label: "自動の判定", strength: "judge" },
  { id: "safety:hook-guard", layer: "safety", label: "フック：安全の見張り（記録だけ）", strength: "watch" },
  { id: "group:■試験グループ", layer: "routing", label: "■試験グループ", sessions: true },
  { id: "group:■別グループ", layer: "routing", label: "■別グループ" },
  { id: "skill:report-style", layer: "skills", label: "report-style", strength: "read" },
  { id: "skill:message-style", layer: "skills", label: "message-style", strength: "read" },
  { id: "agent:search-helper", layer: "skills", label: "探し物の役" },
  { id: "tool:cc-shell", layer: "tools", label: "シェル（Bash・PowerShell）" },
  { id: "tool:cc-edit", layer: "tools", label: "ファイルの書き換え（Edit・Write）" },
  { id: "tool:cc-web", layer: "tools", label: "Web（WebSearch・WebFetch）" },
  { id: "tool:cc-comms", layer: "tools", label: "セッション間の連絡" },
  { id: "tool:browser", layer: "tools", label: "内蔵ブラウザ" },
  { id: "kn:plan", layer: "knowledge", label: "plan.md の台帳", place: docsDir },
  { id: "out:report", layer: "output", label: "完了の報告" },
  { id: "out:commit", layer: "output", label: "コミット" },
  { id: "out:office", layer: "output", label: "Word・Excel・PowerPoint" },
  { id: "out:page", layer: "output", label: "閲覧ページ" },
]

const total = big ? 211 : 105
const ghosts = 11
const nodes = FIXED.map((n) => ({ kind: "試験の箱", strength: "none", place: "", desc: "合成の説明", ...n }))
for (let i = nodes.length; i < total; i++) {
  const layer = LAYERS[i % LAYERS.length].id
  nodes.push({ id: `${layer}:sample-${i}`, layer, label: `試験の箱 ${i}`, kind: "試験の箱", strength: i % 9 === 0 ? "read" : "none", place: "", desc: "合成の説明" })
}
for (let i = 0; i < ghosts; i++) nodes[nodes.length - 1 - i].ghost = true
const group = nodes.find((n) => n.id === "group:■試験グループ")
group.sessions = ["00_リーダー_試験", "01_画面の修正", "02_集計の作成", "03_検証", "04_文書の整備"].map((title) => ({ title, folder: "", role: "担当" }))

const live = nodes.filter((n) => !n.ghost)
const edgeCount = big ? 400 : 69
const edges = []
const pairs = [
  ["skill:message-style", "skill:report-style"],
  ["group:■試験グループ", "skill:report-style"],
  ["safety:hook-guard", "tool:cc-shell"],
  ["tool:cc-edit", "kn:plan"],
  ["tool:cc-comms", "out:report"],
]
for (const [src, dst] of pairs) edges.push({ src, dst, kind: "mention", label: "使う", origin: "試験", note: "" })
edges.push({ src: "safety:deny", dst: "safety:auto", kind: "conflict", label: "食い違い", origin: "試験", note: "" })
// 残りは、つながりの無い箱が残るように、前半の箱どうしでつなぐ
const pool = live.slice(0, Math.ceil(live.length * 0.55))
for (let i = 0; edges.length < edgeCount; i++) {
  const a = pool[i % pool.length]
  const b = pool[(i * 7 + 3) % pool.length]
  if (a.id === b.id) continue
  edges.push({ src: a.id, dst: b.id, kind: i % 5 === 0 ? "manual" : "mention", label: "名前が出てくる", origin: "試験", note: "" })
}

const jst = new Date(Date.now() + 9 * 3600 * 1000 - (stale ? 10 * 86400 * 1000 : 3600 * 1000))
const pad = (n) => String(n).padStart(2, "0")
const generatedAt = `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`
const map = { schema: 1, generated_at: generatedAt, layers: LAYERS, nodes, edges, flows: [], tobe: [], stages: [], findings: [], stats: {}, warnings: [], page_url: "" }
await mkdir(path.join(outDir, "env-map"), { recursive: true })
await mkdir(docsDir, { recursive: true })
await writeFile(path.join(outDir, "env-map", "map.json"), JSON.stringify(map, null, 1))

// 会話ログの末尾に、人の指示1つと道具の呼び出しを足す
let id = 0
const projectsRoot = path.join(outDir, "projects")
const at = (sec) => new Date(Date.now() - sec * 1000).toISOString()
function toolLines(startSec) {
  let t = startSec
  const lines = []
  const tool = (name, input) => {
    t -= 2
    lines.push({ type: "assistant", timestamp: at(t), message: { role: "assistant", content: [{ type: "tool_use", id: `toolu_sample_${++id}`, name, input }] } })
    lines.push({ type: "user", timestamp: at(t - 1), message: { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_sample_${id}`, content: "合成の結果" }] } })
  }
  lines.push({ type: "user", timestamp: at(t), message: { role: "user", content: "合成の指示（全体マップの確認用）" } })
  tool("Skill", { skill: "report-style" })
  for (let i = 0; i < 38; i++) tool("Bash", { command: "echo sample" })
  tool("Read", { file_path: path.join(docsDir, "plan.md") })
  for (let i = 0; i < 12; i++) tool("Edit", { file_path: path.join(outDir, "work", "a.ts") })
  for (let i = 0; i < 6; i++) tool("Bash", { command: "echo sample" })
  for (let i = 0; i < 9; i++) tool("Read", { file_path: path.join(outDir, "work", "b.ts") })
  for (let i = 0; i < 3; i++) tool("Grep", { pattern: "sample" })
  tool("Skill", { skill: "message-style" })
  tool("Agent", { subagent_type: "search-helper", prompt: "合成の依頼" })
  tool("Bash", { command: "git commit -m sample" })
  tool("SendMessage", { to: "main", message: "[完了] 合成の報告" })
  return lines
}
let files = 0
for (const d of await readdir(projectsRoot, { withFileTypes: true })) {
  if (!d.isDirectory()) continue
  for (const f of await readdir(path.join(projectsRoot, d.name), { withFileTypes: true })) {
    if (!f.isFile() || !f.name.endsWith(".jsonl")) continue
    await appendFile(path.join(projectsRoot, d.name, f.name), toolLines(240).map((l) => JSON.stringify(l)).join("\n") + "\n")
    files++
  }
}
console.log(`map: ${live.length} 箱（理想の箱 ${ghosts} を除く）・線 ${edges.length}・作成 ${generatedAt}。会話ログ ${files} 本に道具の行を足した`)
console.log(`mapPath: ${path.resolve(outDir, "env-map", "map.json")}`)
