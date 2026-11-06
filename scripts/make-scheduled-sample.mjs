/**
 * 予定タスクのタブ（⑯ リソース［予定タスク］）の確認用に、合成（架空）の Claude Desktop データを作る。
 * 実際の予定タスクの名前・セッション名・ID・本文は含まない。現在時刻を基準に、30日分の予定タスクの回を作る
 * （画面を開く直前に実行する。古くなったら作り直す）。
 *
 * 使い方:
 *   node scripts/make-scheduled-sample.mjs [--scale <倍率>] [--boundary-ago <日>] <出力先のフォルダ>
 *   --scale        会話記録の大きさの倍率（既定 1。1 で予定タスクの回の会話記録が合計 約150MB。A11 の測定用）
 *   --boundary-ago 境目の日（sample-genai-watch が Sonnet を使い始めた日）を今日の何日前にするか（既定 3）
 * 出力先に data/（Desktop のデータ）・projects/（会話記録）・scheduled-tasks/（予定タスクの定義のフォルダ）・expected.json ができる。
 * 表示する設定を、config/desktop-sessions.json と config/usage.json に書いて、CCD_DESKTOP_AUTODETECT=0 でサーバーを起動する。
 *
 * 作るもの（予定タスク 9つ＋定義だけ2つ。名前はすべて架空）:
 *   sample-genai-watch : 毎日 07:09。境目の8〜30日前は Opus だけ。境目の前の7日は4回で、うち3回に Haiku のサブエージェント（1・1・2本）。
 *                        境目からは毎日 Opus＋Sonnet のサブエージェント2本（種類 general-purpose）。後の7日のうち1回は会話記録なし。
 *                        今日の回は作業中（会話記録の最後が数秒前）
 *   sample-news-clip   : 1日に1〜2回（直近14日の回数が最多）。Opus だけ。1日2回の日がある
 *   sample-inbox       : 毎日。境目の5日前から Haiku のサブエージェントを使い続ける（新しい系統。境目より前なので選ばれない）
 *   sample-repo-health : 2日に1回。時々だけ Haiku（過半数に届かないので選ばれない）
 *   sample-backup      : 毎日。最後の回がエラー
 *   sample-weekly      : 週に1回（最後の回が24時間より前）
 *   sample-late        : 境目の後に初めて動いた（初回は数えない）。Sonnet が本体
 *   sample-version     : 毎日。境目の後に本体の版だけ替わった（同じ系統なので新しいと数えない）
 *   sample-dormant     : 20日前より前だけ動いた（直近14日に動いていない）。最後の回はアーカイブ済みで要対応
 *   sample-unused-a・sample-unused-b : 定義のフォルダだけ（回が無い）
 */
import { mkdir, rm, writeFile, utimes } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ACCOUNT = "00000000-0000-4000-8000-0000000000a1"
const ORG = "00000000-0000-4000-8000-0000000000b1"
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const SENTINEL = "SENTINEL-DO-NOT-LEAK-7f3a9c"

const OPUS = "claude-opus-5-5"
const OPUS_OLD = "claude-opus-5-0"
const SONNET = "claude-sonnet-5-5"
const HAIKU = "claude-haiku-5-5"

const sid = (n) => `local_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const cli = (n) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`

/** 決まった種の乱数(何度作っても同じ形) */
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** 日の0時(PC の時刻) */
function midnight(at) {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function makeScheduledSample(outDir, { scale = 1, boundaryAgo = 3, now = Date.now() } = {}) {
  const dataDir = path.join(outDir, "data")
  const sessionsDir = path.join(dataDir, "claude-code-sessions", ACCOUNT, ORG)
  const projectsRoot = path.join(outDir, "projects")
  const projectDir = path.join(projectsRoot, "C--sample-scheduled")
  const definitionsRoot = path.join(outDir, "scheduled-tasks")
  const today = midnight(now)
  const boundary = today - boundaryAgo * DAY
  const rand = rng(16)
  const filler = "合成のツール出力。".repeat(Math.max(1, Math.round(1300 * scale)))

  /** 回の一覧。day は今日からの日数(負=前)、minute はその日の0時からの分 */
  const runs = []
  let n = 1
  const add = (taskId, at, o = {}) => runs.push({ n: n++, taskId, at, ...o })
  const dayAt = (days, h, m) => today + days * DAY + h * HOUR + m * MIN

  for (let d = -30; d <= 0; d++) {
    const t = today + d * DAY
    // sample-genai-watch
    if (t < boundary - 7 * DAY) add("sample-genai-watch", dayAt(d, 7, 9), { main: OPUS })
    else if (t < boundary) {
      const k = Math.round((t - (boundary - 7 * DAY)) / DAY)
      const before = { 0: [HAIKU, 1], 2: [HAIKU, 1], 4: [null, 0], 6: [HAIKU, 2] }[k]
      if (before) add("sample-genai-watch", dayAt(d, 7, 9), { main: OPUS, sub: before[0], subCount: before[1], subType: "web-fetch" })
    } else {
      const k = Math.round((t - boundary) / DAY)
      add("sample-genai-watch", dayAt(d, 7, 9), {
        main: OPUS,
        mainScale: 0.6,
        sub: SONNET,
        subCount: 2,
        subType: "general-purpose",
        noTranscript: k === 1,
        running: d === 0,
      })
    }
    // sample-news-clip(1日に1〜2回)
    add("sample-news-clip", dayAt(d, 12, 30), { main: OPUS, mainScale: 0.8 })
    if (d % 3 === 0) add("sample-news-clip", dayAt(d, 18, 45), { main: OPUS, mainScale: 0.5 })
    // sample-inbox(境目の5日前から Haiku を使い続ける)
    add("sample-inbox", dayAt(d, 6, 0), t >= boundary - 5 * DAY ? { main: OPUS, mainScale: 0.4, sub: HAIKU, subCount: 1, subType: "Explore" } : { main: OPUS, mainScale: 0.4 })
    // sample-repo-health(2日に1回。時々だけ Haiku)
    if (d % 2 === 0) add("sample-repo-health", dayAt(d, 9, 15), d % 8 === 0 ? { main: OPUS, mainScale: 0.3, sub: HAIKU, subCount: 1 } : { main: OPUS, mainScale: 0.3 })
    // sample-backup(最後の回がエラー)
    add("sample-backup", dayAt(d, 3, 0), { main: SONNET, mainScale: 0.2, error: d === 0 })
    // sample-weekly(週に1回。最後は2日前)
    if ((d + 2) % 7 === 0) add("sample-weekly", dayAt(d, 8, 0), { main: OPUS, mainScale: 1.2 })
    // sample-late(境目の後に初めて動いた)
    if (t > boundary) add("sample-late", dayAt(d, 10, 0), { main: SONNET, mainScale: 0.3 })
    // sample-version(境目の後に本体の版だけ替わった)
    add("sample-version", dayAt(d, 5, 30), { main: t >= boundary ? OPUS : OPUS_OLD, mainScale: 0.3 })
    // sample-dormant(20日前より前だけ)
    if (d <= -20 && d % 3 === 0) add("sample-dormant", dayAt(d, 4, 0), { main: OPUS, mainScale: 0.3, blocked: d === -21 })
  }
  const latest = runs.filter((r) => r.at <= now)
  // 未来の時刻の回は作らない(今日の 07:09 より前に作ったときなど)
  const kept = latest

  let msgSeq = 0
  /** 1回の応答の行(同じ message.id の行を2つ。重複の除き方の確かめを兼ねる) */
  function assistantLines(at, model, size) {
    const id = `msg_sample_${String(++msgSeq).padStart(8, "0")}`
    const usage = {
      input_tokens: 5,
      output_tokens: Math.round(700 * size),
      cache_read_input_tokens: Math.round(40_000 * size),
      cache_creation_input_tokens: Math.round(2_000 * size),
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: Math.round(2_000 * size) },
    }
    const ts = new Date(at).toISOString()
    const base = { type: "assistant", timestamp: ts, message: { id, model, role: "assistant", usage } }
    return [
      JSON.stringify({ ...base, uuid: `a-${msgSeq}-1`, message: { ...base.message, content: [{ type: "text", text: "合成の応答。" }] } }),
      JSON.stringify({ ...base, uuid: `a-${msgSeq}-2`, message: { ...base.message, content: [{ type: "tool_use", id: `tu_${msgSeq}`, name: "Read", input: {} }] } }),
    ]
  }
  function toolResultLine(at) {
    return JSON.stringify({
      type: "user",
      timestamp: new Date(at).toISOString(),
      uuid: `u-${msgSeq}`,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tu_${msgSeq}`, content: filler }] },
    })
  }
  function conversation(start, model, messages, size) {
    const lines = [
      JSON.stringify({ type: "user", timestamp: new Date(start).toISOString(), uuid: `h-${msgSeq}`, message: { role: "user", content: "合成の予定タスクの指示。" } }),
    ]
    let at = start
    for (let i = 0; i < messages; i++) {
      at += 20_000 + Math.round(rand() * 20_000)
      lines.push(...assistantLines(at, model, size))
      at += 5_000
      lines.push(toolResultLine(at))
    }
    // 最後は本文だけの応答(ターンの終わり)。この uuid を、メタデータのターン後の要約に対応させる
    at += 15_000
    const lastUuid = `a-${++msgSeq}-end`
    lines.push(
      JSON.stringify({
        type: "assistant",
        uuid: lastUuid,
        timestamp: new Date(at).toISOString(),
        message: { id: `msg_sample_end_${msgSeq}`, model, role: "assistant", content: [{ type: "text", text: "合成の結び。" }], usage: { input_tokens: 5, output_tokens: 200, cache_read_input_tokens: 40_000 } },
      })
    )
    return { lines, end: at, lastUuid }
  }

  const write = async () => {
    await rm(outDir, { recursive: true, force: true })
    await mkdir(sessionsDir, { recursive: true })
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(dataDir, "claude_desktop_config.json"), JSON.stringify({ preferences: {} }), "utf-8")
    const tasks = [...new Set(kept.map((r) => r.taskId)), "sample-unused-a", "sample-unused-b"]
    for (const t of tasks) {
      await mkdir(path.join(definitionsRoot, t), { recursive: true })
      await writeFile(path.join(definitionsRoot, t, "SKILL.md"), `合成の定義（${SENTINEL}）\n`, "utf-8")
    }
    let totalBytes = 0
    for (const r of kept) {
      const running = r.running === true
      const start = running ? now - 25 * MIN : r.at
      const conv = conversation(start, r.main, Math.round(60 * (r.mainScale ?? 1)), 1)
      if (running) {
        // 作業中：最後の結びの行を外し、最後の行(ツールの結果)を数秒前にそろえる
        conv.lines.pop()
        conv.end = now - 5_000
        conv.lines[conv.lines.length - 1] = conv.lines[conv.lines.length - 1].replace(/"timestamp":"[^"]+"/, `"timestamp":"${new Date(conv.end).toISOString()}"`)
      }
      if (!r.noTranscript) {
        const file = path.join(projectDir, `${cli(r.n)}.jsonl`)
        const body = conv.lines.join("\n") + "\n"
        totalBytes += Buffer.byteLength(body)
        await writeFile(file, body, "utf-8")
        await utimes(file, new Date(conv.end), new Date(conv.end))
        for (let k = 0; k < (r.subCount ?? 0); k++) {
          const dir = path.join(projectDir, cli(r.n), "subagents")
          await mkdir(dir, { recursive: true })
          const agent = `agent-${String(r.n).padStart(6, "0")}${k}`
          const sub = conversation(start + (k + 1) * 60_000, r.sub, r.sub === SONNET ? 12 : 25, 0.8)
          const subBody = sub.lines.join("\n") + "\n"
          totalBytes += Buffer.byteLength(subBody)
          await writeFile(path.join(dir, `${agent}.jsonl`), subBody, "utf-8")
          await utimes(path.join(dir, `${agent}.jsonl`), new Date(sub.end), new Date(sub.end))
          // 種類の記録は、最後の1本だけ付けない回がある(「種類不明」の確かめ)
          if (r.subType && !(r.taskId === "sample-repo-health")) {
            await writeFile(path.join(dir, `${agent}.meta.json`), JSON.stringify({ agentType: r.subType, description: SENTINEL, isBuiltIn: true }), "utf-8")
          }
        }
      }
      const meta = {
        sessionId: sid(r.n),
        cliSessionId: cli(r.n),
        cwd: "C:\\sample\\scheduled",
        createdAt: start,
        lastActivityAt: conv.end,
        model: r.main,
        effort: "high",
        isArchived: !running && now - r.at > 2 * DAY,
        title: `合成の予定タスクの回 ${r.n}`,
        permissionMode: "acceptEdits",
        completedTurns: 1,
        scheduledTaskId: r.taskId,
        systemPrompt: SENTINEL,
      }
      if (!running) {
        meta.postTurnSummary = r.blocked
          ? { status_category: "blocked", needs_action: "合成の要対応", summarizes_uuid: conv.lastUuid }
          : { status_category: "completed", summarizes_uuid: conv.lastUuid }
        meta.postTurnSummaryFor = conv.lastUuid
        meta.lastAssistantUuid = conv.lastUuid
      }
      if (r.error) {
        meta.error = "合成のエラー"
        meta.errorAt = conv.end
      }
      await writeFile(path.join(sessionsDir, `${sid(r.n)}.json`), JSON.stringify(meta), "utf-8")
    }
    return totalBytes
  }

  const genai = kept.filter((r) => r.taskId === "sample-genai-watch")
  return {
    dataDir,
    projectsRoot,
    definitionsRoot,
    write,
    expected: {
      sessionCount: kept.length,
      sessionIds: kept.map((r) => sid(r.n)).sort(),
      scheduled: {
        tasks: new Set(kept.map((r) => r.taskId)).size,
        definitions: new Set(kept.map((r) => r.taskId)).size + 2,
        defaultTask: "sample-genai-watch",
        boundaryAgo,
        genaiRuns: genai.length,
      },
    },
  }
}

async function main() {
  const args = process.argv.slice(2)
  let scale = 1
  let boundaryAgo = 3
  const rest = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scale") scale = Number(args[++i])
    else if (args[i] === "--boundary-ago") boundaryAgo = Number(args[++i])
    else rest.push(args[i])
  }
  const out = rest[0]
  if (!out || !Number.isFinite(scale) || scale <= 0 || !Number.isInteger(boundaryAgo) || boundaryAgo < 0) {
    console.error("使い方: node scripts/make-scheduled-sample.mjs [--scale <倍率>] [--boundary-ago <日>] <出力先のフォルダ>")
    process.exit(1)
  }
  const outDir = path.resolve(out)
  const sample = makeScheduledSample(outDir, { scale, boundaryAgo })
  const bytes = await sample.write()
  await writeFile(path.join(outDir, "expected.json"), JSON.stringify(sample.expected, null, 2) + "\n", "utf-8")
  console.log(`合成データを作りました: ${outDir}（予定タスクの回 ${sample.expected.sessionCount}件・会話記録 ${(bytes / 1024 / 1024).toFixed(1)}MB）`)
  console.log("config/desktop-sessions.json に、次の内容を書いてください（パスは絶対パス）:")
  console.log(JSON.stringify({ dataDir: sample.dataDir, projectsRoot: sample.projectsRoot }, null, 2))
  console.log("config/usage.json に、次の内容を書いてください:")
  console.log(JSON.stringify({ projectsRoot: sample.projectsRoot }, null, 2))
  console.log("サーバーは CCD_DESKTOP_AUTODETECT=0 を付けて起動してください。撮る前に確かめる:")
  console.log(`  node scripts/check-sample-server.mjs http://127.0.0.1:3961 ${outDir}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main()
}
