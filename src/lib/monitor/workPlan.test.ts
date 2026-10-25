import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MonitorService, parseMonitorConfig, readMonitorFile } from "./monitorService"
import { sessionLabel, summarizePlan, summarizeQueue } from "./workPlan"

// 値はどれも合成(本物の題名・ID ではない)
const NOW = new Date(2026, 9, 24, 9, 0).getTime()
const PLAN_HEAD = "date\tsession\tgroup\ttask\tsize\tresume\torder\tstate"
const QUEUE_HEAD = "date\tsession\tgroup\tresets_at\tstate\tnext"
const TITLES = new Map([
  ["local_aaaa0001-0000", "01_画面"],
  ["local_bbbb0002-0000", "02_集計"],
])

describe("[WC-1] 作業計画は同じセッションと作業の最後の行を今にする(A1・A28)", () => {
  const text = [
    PLAN_HEAD,
    "2026-10-24 06:12\tlocal_aaaa0001-0000\tアプリ\t表を作る\t中\t易\t1\ttodo\r",
    "2026-10-24 06:30\tlocal_aaaa0001-0000\tアプリ\t表を作る\t中\t易\t1\tdoing",
    "2026-10-24 06:40\tlocal_bbbb0002-0000\tアプリ\t集計の直し\t小\t難\t2\ttodo\r",
    "2026-10-24 06:41\tlocal_cccc0003-0000\t情報収集\t調べもの\t大\t易\t3\tlater",
    "2026-10-24 06:50\tlocal_cccc0003-0000\t情報収集\t前の調べもの\t小\t易\t1\tdone",
    "2026-10-24 06:51\tlocal_bbbb0002-0000\tアプリ\t列の足りない行\t小\t易",
    "",
    "2026-10-24 06:52\tlocal_bbbb0002-0000\tアプリ\t状態が変\t小\t易\t1\tunknown",
  ].join("\n")

  it("CRLF と LF が混ざっても読み、列の足りない行・状態の読めない行は飛ばして数える。済みは件数だけ", () => {
    const res = summarizePlan(text, TITLES, new Set())
    expect(res.skipped).toBe(2)
    expect(res.doneCount).toBe(1)
    expect(res.groups.map((g) => [g.name, g.counts.doing, g.counts.todo, g.counts.later])).toEqual([
      ["アプリ", 1, 1, 0],
      ["情報収集", 0, 0, 1],
    ])
    const first = res.groups[0].items[0]
    expect(first).toMatchObject({ title: "01_画面", task: "表を作る", state: "doing", order: 1, size: "中", resume: "易" })
  })

  it("列は見出しの名前で読む(順番が変わっても読める)", () => {
    const swapped = ["state\torder\tresume\tsize\ttask\tgroup\tsession\tdate", "doing\t2\t易\t大\t入れ替え\tアプリ\tlocal_aaaa0001-0000\t2026-10-24 07:00"].join("\n")
    expect(summarizePlan(swapped, TITLES, new Set()).groups[0].items[0]).toMatchObject({ task: "入れ替え", order: 2, size: "大" })
  })

  it("待ち行列にいるセッションの作業中の行は「待ち（上限）」", () => {
    const res = summarizePlan(text, TITLES, new Set(["local_aaaa0001-0000"]))
    expect(res.groups[0].items[0].state).toBe("waiting")
    expect(res.groups[0].counts).toMatchObject({ doing: 0, waiting: 1 })
  })

  it("作業の名前の秘密とパスは伏せる", () => {
    const leak = [PLAN_HEAD, "2026-10-24 07:00\tlocal_aaaa0001-0000\tアプリ\tAPI_TOKEN=abc123 で C:\\Users\\someone\\work を見る\t小\t易\t1\tdoing"].join("\n")
    const task = summarizePlan(leak, TITLES, new Set()).groups[0].items[0].task
    expect(task).not.toContain("abc123")
    expect(task).not.toContain("someone")
  })
})

describe("[WC-2] 待ち行列はセッションごとの最後の行が wait のものだけ(A2)", () => {
  const text = [
    QUEUE_HEAD,
    "2026-10-24 05:34\tlocal_aaaa0001-0000\tアプリ\t2026-10-24T01:30:00Z\twait\t続きの表",
    "2026-10-24 06:00\tlocal_bbbb0002-0000\tアプリ\t2026-10-24T00:30:00Z\twait\t集計",
    "2026-10-24 06:31\tlocal_bbbb0002-0000\tアプリ\t\tsent\t",
    "2026-10-24 06:40\tlocal_bbbb0002-0000\tアプリ\t\tresumed\t",
    "2026-10-23 23:00\tlocal_cccc0003-0000\t情報収集\t\tresumed\t",
    "2026-10-24 06:45\tlocal_dddd0004-0000\t情報収集\t\twait\t時刻の無い待ち",
    "2026-10-24 06:46\tlocal_eeee0005-0000",
  ].join("\n")

  it("最後が wait のものだけ。回復の早い順で、時刻の無いものは最後。今日の再開した・起こした件数", () => {
    const res = summarizeQueue(text, TITLES, NOW)
    expect(res.items.map((i) => [i.title, i.next])).toEqual([
      ["01_画面", "続きの表"],
      ["local_dddd0004…", "時刻の無い待ち"],
    ])
    expect(res.items[0].resetsAt).toBe(Date.parse("2026-10-24T01:30:00Z"))
    expect(res.items[1].resetsAt).toBeNull()
    expect([res.resumedToday, res.sentToday, res.skipped]).toEqual([1, 1, 1])
    expect([...res.waitingIds]).toEqual(["local_aaaa0001-0000", "local_dddd0004-0000"])
  })
})

describe("[WC-7] セッションの名前(A7)", () => {
  it("Desktop で結べたら今の題名、ファイルの題名、それも無ければ ID の先頭8文字", () => {
    expect(sessionLabel("local_aaaa0001-0000", TITLES, "古い題名")).toBe("01_画面")
    expect(sessionLabel("local_zzzz9999-0000", TITLES, "ファイルの題名")).toBe("ファイルの題名")
    expect(sessionLabel("local_zzzz9999-0000", TITLES)).toBe("local_zzzz9999…")
  })
})

describe("[WC-8] 設定ファイル(A8)", () => {
  it("設定が無いときはエラーにせず configured=false で返す", async () => {
    const res = await new MonitorService({ config: async () => null, sessions: async () => new Map(), now: () => NOW }).plan()
    expect(res.configured).toBe(false)
    expect(res.plan.status).toBe("unset")
  })

  it("見本の config/monitor.example.json に個人のパスが無い", async () => {
    const example = await fs.readFile(path.resolve(__dirname, "../../../config/monitor.example.json"), "utf-8")
    const parsed = parseMonitorConfig(JSON.parse(example))
    expect(parsed.workPlanFile).toBeTruthy()
    expect(example).not.toMatch(/Users[\\/]+(?!Public)|AppData|OneDrive/i)
  })
})

describe("[WC-9] [WC-10] 読むだけ・パスと生の行を返さない(A10・A11)", () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-monitor-"))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("ファイルに書き込まない。応答にパスと生の行が無い", async () => {
    const plan = path.join(tmp, "work_plan.tsv")
    const queue = path.join(tmp, "resume_queue.tsv")
    await fs.writeFile(plan, `${PLAN_HEAD}\n2026-10-24 06:30\tlocal_aaaa0001-0000\tアプリ\t表を作る\t中\t易\t1\tdoing\n`, "utf-8")
    await fs.writeFile(queue, `${QUEUE_HEAD}\n2026-10-24 05:34\tlocal_aaaa0001-0000\tアプリ\t2026-10-24T01:30:00Z\twait\t続き\n`, "utf-8")
    const writes = [vi.spyOn(fs, "writeFile"), vi.spyOn(fs, "appendFile"), vi.spyOn(fs, "rm"), vi.spyOn(fs, "unlink")]
    const res = await new MonitorService({
      config: async () => ({ workPlanFile: plan, resumeQueueFile: queue }),
      sessions: async () => new Map([...TITLES].map(([id, title]) => [id, { title, group: null }])),
      now: () => NOW,
    }).plan()
    for (const w of writes) expect(w).not.toHaveBeenCalled()
    expect(res.plan.groups[0].items[0].state).toBe("waiting")
    const json = JSON.stringify(res)
    expect(json).not.toContain(tmp.replace(/\\/g, "\\\\"))
    expect(json).not.toContain("work_plan.tsv")
    expect(json).not.toContain("2026-10-24 06:30")
  })

  it("無いファイルは missing、拒否リストに当たる場所は読まずに refused", async () => {
    expect((await readMonitorFile(path.join(tmp, "none.tsv"))).status).toBe("missing")
    expect((await readMonitorFile(path.join(tmp, ".env"))).status).toBe("refused")
    expect((await readMonitorFile(undefined)).status).toBe("unset")
  })
})

describe("[WC-10] 見張りの API はスマホ(LAN の入り口の経由)に出さない(⑭ のゲート2 の L2)", () => {
  it("入り口の印つきの要求は、記録を読む前に 403", async () => {
    const { GET: plan } = await import("@/app/api/monitor/plan/route")
    const { GET: load } = await import("@/app/api/monitor/load/route")
    const { GET: snapshot } = await import("@/app/api/monitor/snapshot/route")
    const { GET: alerts } = await import("@/app/api/monitor/alerts/route")
    const req = (p: string) => new NextRequest(`http://127.0.0.1:3000/api/monitor/${p}`, { headers: { "x-ccd-via-lan": "1" } })
    const res = await Promise.all([plan(req("plan")), load(req("load?range=1")), snapshot(req("snapshot?at=1")), alerts(req("alerts"))])
    expect(res.map((r) => r.status)).toEqual([403, 403, 403, 403])
  })
})
