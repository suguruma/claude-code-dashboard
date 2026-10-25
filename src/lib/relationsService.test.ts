import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeSessionSummary } from "./desktopFixtures"
import type { DesktopSessionService, RelationSource } from "./desktopSessionService"
import type { DesktopSessionListResponse, DesktopSessionSummary } from "./desktopSessionTypes"
import type { PeerReceipt } from "./desktopSessions"
import {
  isCloudFolder,
  parseRelationsConfig,
  readLedgerMark,
  RelationsService,
  roleOf,
  summaryOfReceipt,
  USER_SKILLS_DIR_ENV,
  type RelationsConfig,
} from "./relationsService"
import type { RelationsResponse } from "./relationsTypes"

const NOW = Date.UTC(2026, 9, 25, 3, 0, 0)
const MIN = 60_000

let tmp: string
const oldDataDir = process.env.CCD_DATA_DIR

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-relations-"))
  // 組織のルールの設定(config/org-rules.json)を、この PC のものではなく空のフォルダから読む
  process.env.CCD_DATA_DIR = tmp
})

afterEach(async () => {
  if (oldDataDir === undefined) delete process.env.CCD_DATA_DIR
  else process.env.CCD_DATA_DIR = oldDataDir
  await fs.rm(tmp, { recursive: true, force: true })
})

interface SourceInput {
  summary: DesktopSessionSummary
  filePath?: string | null
  branch?: string | null
  receipts?: PeerReceipt[]
  skills?: Array<{ name: string; at: number | null }>
}

/** 一覧と関係の材料だけを返す、DesktopSessionService の代わり */
function fakeSessions(inputs: SourceInput[], groups: Array<{ id: string; name: string }>): DesktopSessionService {
  const sources: RelationSource[] = inputs.map((i) => ({
    summary: i.summary,
    filePath: i.filePath ?? null,
    relation: { writtenBranch: i.branch ?? null, peerReceipts: i.receipts ?? [], skillCalls: i.skills ?? [] },
  }))
  const list = {
    generatedAt: NOW,
    source: "desktop",
    groups: groups.map((g, order) => ({ ...g, order, count: 0 })),
    sessions: inputs.map((i) => i.summary),
  } as unknown as DesktopSessionListResponse
  return {
    relationSources: async () => ({ list, sources }),
    orchestratorPrefix: () => "00_",
  } as unknown as DesktopSessionService
}

const G_APP = { id: "g-app", name: "アプリ" }
const G_INFO = { id: "g-info", name: "情報収集" }

function service(inputs: SourceInput[], config: RelationsConfig | null, extra: { global?: string; skills?: string } = {}) {
  return new RelationsService(fakeSessions(inputs, [G_APP, G_INFO]), {
    config: async () => config,
    globalClaudeMdPath: async () => extra.global,
    env: { CCD_DESKTOP_AUTODETECT: "0", ...(extra.skills ? { [USER_SKILLS_DIR_ENV]: extra.skills } : {}) },
    now: () => NOW,
  })
}

const receipt = (target: string, over: Partial<PeerReceipt> = {}): PeerReceipt => ({
  targetSessionId: target,
  sentAt: NOW - 60 * MIN,
  delivery: "delivered",
  deliveredAt: NOW - 59 * MIN,
  readAt: null,
  repliedAt: null,
  ...over,
})

describe("[RM-2] 役割(A12)", () => {
  it("題名の決まり(既定は 00_ と 補助)だけで分ける", () => {
    expect(roleOf("00_指揮役_アプリ", /^00_/, /^補助/)).toBe("leader")
    expect(roleOf("補助_画面の検証", /^00_/, /^補助/)).toBe("helper")
    expect(roleOf("01_画面の修正", /^00_/, /^補助/)).toBe("member")
    // 題名の途中に「補助」があっても、頭でなければ担当
    expect(roleOf("01_補助の整理", /^00_/, /^補助/)).toBe("member")
  })

  it("設定の leaderPattern・helperPattern・roleLabels で変えられる。立てた記録は spawnedFrom があるときだけ", async () => {
    const res = await service(
      [
        { summary: makeSessionSummary("local_a1", { title: "LEAD アプリ", group: G_APP }) },
        { summary: makeSessionSummary("local_a2", { title: "check-01", group: G_APP, spawnedFromId: "local_a1" }) },
        { summary: makeSessionSummary("local_a3", { title: "00_古い頭", group: G_APP }) },
      ],
      { leaderPattern: "LEAD", helperPattern: "check-", roleLabels: { leader: "まとめ役" } }
    ).get()
    const role = Object.fromEntries(res.sessions.map((s) => [s.id, s.role]))
    expect(role).toEqual({ local_a1: "leader", local_a2: "helper", local_a3: "member" })
    expect(res.roleLabels).toEqual({ leader: "まとめ役", member: "担当", helper: "確認役・補助" })
    expect(res.sessions.find((s) => s.id === "local_a2")?.spawnedFromId).toBe("local_a1")
    expect(res.sessions.find((s) => s.id === "local_a3")?.spawnedFromId).toBeNull()
  })

  it("設定が無ければ configured は false で、指示の置き場の札は出さない(D4)", async () => {
    const res = await service([{ summary: makeSessionSummary("local_b1", { title: "01_画面", group: G_APP }) }], null).get()
    expect(res.configured).toBe(false)
    expect(res.sessions[0].orders).toBeNull()
    expect(res.sessions[0].reports).toBeNull()
  })

  it("設定ファイルの形に合わない値は捨てる", () => {
    expect(parseRelationsConfig({ leaderPattern: 3, members: [{ titlePrefix: "" }, { titlePrefix: "01_", ordersFile: "x.md" }, null] })).toEqual({
      leaderPattern: undefined,
      helperPattern: undefined,
      ordersHeading: undefined,
      reportsHeading: undefined,
      members: [{ titlePrefix: "01_", ordersFile: "x.md", reportsFile: undefined }],
    })
    expect(parseRelationsConfig(null)).toEqual({})
  })
})

describe("[RM-3] グループ(A13)", () => {
  it("グループごとの件数・判断の数・返事の無い頼み・立てた線の数を返し、グループ外もまとめる", async () => {
    const res = await service(
      [
        { summary: makeSessionSummary("local_c1", { title: "00_指揮役_アプリ", group: G_APP }), receipts: [receipt("local_c3")] },
        { summary: makeSessionSummary("local_c2", { title: "01_画面", group: G_APP, status: "blocked", needsAction: true, spawnedFromId: "local_c1" }) },
        { summary: makeSessionSummary("local_c3", { title: "00_指揮役_情報", group: G_INFO }) },
        { summary: makeSessionSummary("local_c4", { title: "単発の相談", group: null }) },
      ],
      null
    ).get()
    expect(res.groups.map((g) => [g.id, g.count, g.decisions, g.unansweredRequests, g.spawnedLinks])).toEqual([
      ["g-app", 2, 1, 1, 1],
      ["g-info", 1, 0, 0, 0],
      ["none", 1, 0, 0, 0],
    ])
  })
})

describe("[RM-4] 指示のファイル・報告の台帳(A14)", () => {
  it("見出しの最後の番号と更新時刻だけを返す(本文は返さない)", async () => {
    const orders = path.join(tmp, "01.md")
    await fs.writeFile(orders, "# 指示\n\n### 指示41: 秘密の本文\n本文\n### 指示43: 次の本文\n本文\n### 指示42: 順が逆\n", "utf-8")
    const mark = await readLedgerMark(orders, /^### 指示(\d+)/gm)
    expect(mark).toMatchObject({ name: "01.md", lastNumber: 43, status: "ok" })
    expect(typeof mark.updatedAt).toBe("number")
    expect(JSON.stringify(mark)).not.toContain("本文")
  })

  it("無いファイルは missing、拒否リストに当たる場所は読まずに refused", async () => {
    expect((await readLedgerMark(path.join(tmp, "none.md"), /^### 指示(\d+)/gm)).status).toBe("missing")
    const secret = path.join(tmp, ".env")
    await fs.writeFile(secret, "### 指示1", "utf-8")
    expect(await readLedgerMark(secret, /^### 指示(\d+)/gm)).toMatchObject({ status: "refused", lastNumber: null, updatedAt: null })
  })

  it("設定で題名の頭と結んだ担当にだけ、指示と報告の印が付く", async () => {
    const orders = path.join(tmp, "orders-01.md")
    const plan = path.join(tmp, "plan.md")
    await fs.writeFile(orders, "### 指示7: x\n", "utf-8")
    await fs.writeFile(plan, "### 報告5\n### 報告6\n", "utf-8")
    const res = await service(
      [
        { summary: makeSessionSummary("local_d1", { title: "01_画面", group: G_APP }) },
        { summary: makeSessionSummary("local_d2", { title: "02_集計", group: G_APP }) },
      ],
      { members: [{ titlePrefix: "01_", ordersFile: orders, reportsFile: plan }] }
    ).get()
    const d1 = res.sessions.find((s) => s.id === "local_d1")!
    expect(d1.orders).toMatchObject({ name: "orders-01.md", lastNumber: 7, status: "ok" })
    expect(d1.reports).toMatchObject({ name: "plan.md", lastNumber: 6, status: "ok" })
    expect(res.sessions.find((s) => s.id === "local_d2")?.orders).toBeNull()
    expect(res.configured).toBe(true)
    // パスは返さない
    expect(JSON.stringify(res)).not.toContain(tmp.replace(/\\/g, "\\\\"))
  })

  it("結びにグループ(名前か ID)を書くと、同じ題名の頭でもグループが一致したセッションにだけ結ぶ", async () => {
    const ordersApp = path.join(tmp, "orders-app.md")
    const ordersInfo = path.join(tmp, "orders-info.md")
    await fs.writeFile(ordersApp, "### 指示3: x\n", "utf-8")
    await fs.writeFile(ordersInfo, "### 指示9: x\n", "utf-8")
    const sources = [
      { summary: makeSessionSummary("local_g1", { title: "01_画面", group: G_APP }) },
      { summary: makeSessionSummary("local_g2", { title: "01_収集", group: G_INFO }) },
      { summary: makeSessionSummary("local_g3", { title: "01_無所属", group: null }) },
    ]
    const res = await service(sources, {
      members: [
        { titlePrefix: "01_", ordersFile: ordersApp },
        { titlePrefix: "01_", group: "情報収集", ordersFile: ordersInfo },
      ],
    }).get()
    const lastOf = (id: string) => res.sessions.find((s) => s.id === id)?.orders?.lastNumber ?? null
    expect([lastOf("local_g1"), lastOf("local_g2"), lastOf("local_g3")]).toEqual([3, 9, 3])

    // グループの ID でも結べる。グループを書いた結びしか無ければ、ほかのグループには結ばない
    const byId = await service(sources, { members: [{ titlePrefix: "01_", group: "g-app", ordersFile: ordersApp }] }).get()
    expect(byId.sessions.map((s) => s.orders?.lastNumber ?? null)).toEqual([3, null, null])
  })
})

describe("[RM-5] 作業フォルダとブランチ(A15)", () => {
  it("ブランチは書き込んだ記録だけから出し、無ければ null。同じ作業フォルダのほかのセッションを返す", async () => {
    const res = await service(
      [
        { summary: makeSessionSummary("local_e1", { title: "01_画面", group: G_APP, cwd: "C:\\sample\\app-one", folderName: "app-one" }), branch: "feat/decisions" },
        { summary: makeSessionSummary("local_e2", { title: "99_配布", group: G_APP, cwd: "c:\\sample\\APP-ONE\\", folderName: "app-one" }) },
        { summary: makeSessionSummary("local_e3", { title: "02_集計", group: G_APP, cwd: "C:\\sample\\report", folderName: "report" }) },
      ],
      null
    ).get()
    const by = Object.fromEntries(res.sessions.map((s) => [s.id, s]))
    expect(by.local_e1.branch).toBe("feat/decisions")
    expect(by.local_e2.branch).toBeNull()
    expect(by.local_e1.sameFolderIds).toEqual(["local_e2"])
    expect(by.local_e2.sameFolderIds).toEqual(["local_e1"])
    expect(by.local_e3.sameFolderIds).toEqual([])
  })
})

describe("[RM-6] 効いているもの(A16)", () => {
  async function setup() {
    const home = path.join(tmp, "home")
    const global = path.join(home, ".claude", "CLAUDE.md")
    const skills = path.join(home, ".claude", "skills")
    const work = path.join(tmp, "work")
    const app = path.join(work, "app-one")
    const logs = path.join(tmp, "projects", "C--work-app-one")
    await fs.mkdir(path.join(skills, "skill-a"), { recursive: true })
    await fs.mkdir(path.join(skills, "skill-b"), { recursive: true })
    await fs.mkdir(path.join(skills, "skill-c"), { recursive: true })
    await fs.writeFile(global, "# 全体\n本文は返さない", "utf-8")
    await fs.mkdir(app, { recursive: true })
    await fs.writeFile(path.join(work, "CLAUDE.md"), "上の決まり", "utf-8")
    await fs.writeFile(path.join(app, "CLAUDE.md"), "作業フォルダの決まり", "utf-8")
    await fs.mkdir(path.join(logs, "memory"), { recursive: true })
    await fs.writeFile(path.join(logs, "memory", "MEMORY.md"), "- 記憶", "utf-8")
    await fs.writeFile(path.join(logs, "memory", "fact.md"), "記憶の本文", "utf-8")
    await fs.writeFile(path.join(logs, "s1.jsonl"), "", "utf-8")
    return { global, skills, app, logs }
  }

  it("全体の決まり・作業フォルダとその上の CLAUDE.md・会話ログの置き場の memory・スキルを、効く先つきで返す(本文・パスは返さない)", async () => {
    const { global, skills, app, logs } = await setup()
    const res = await service(
      [
        {
          summary: makeSessionSummary("local_f1", { title: "01_画面", group: G_APP, cwd: app }),
          filePath: path.join(logs, "s1.jsonl"),
          skills: [
            { name: "skill-a", at: NOW - 2 * 24 * 60 * MIN },
            { name: "skill-a", at: NOW - 3 * 24 * 60 * MIN },
            { name: "old-skill", at: NOW - 40 * 24 * 60 * MIN },
          ],
        },
        { summary: makeSessionSummary("local_f2", { title: "02_集計", group: G_APP, cwd: "C:\\Users\\someone\\OneDrive\\docs" }), skills: [{ name: "skill-b", at: NOW - MIN }] },
      ],
      null,
      { global, skills }
    ).get()
    const e = res.effects
    expect(e.global.status).toBe("ok")
    const rules = e.folderRules.filter((r) => r.sessionIds.includes("local_f1")).map((r) => r.label)
    expect(rules).toEqual(expect.arrayContaining(["app-one", "work"]))
    expect(e.memories).toHaveLength(1)
    expect(e.memories[0]).toMatchObject({ count: 2, sessionIds: ["local_f1"] })
    expect(e.userSkills).toBe(3)
    // 直近30日の呼び出しだけ。多い順
    expect(e.usedSkills).toEqual([
      { name: "skill-a", calls: 2, sessionIds: ["local_f1"] },
      { name: "skill-b", calls: 1, sessionIds: ["local_f2"] },
    ])
    // クラウドのフォルダは中を調べない
    expect(e.cloudSkipped).toBe(1)
    expect(e.folderRules.some((r) => r.sessionIds.includes("local_f2"))).toBe(false)
    const json = JSON.stringify(res)
    expect(json).not.toContain("本文")
    expect(json).not.toContain("作業フォルダの決まり")
    expect(json).not.toContain(tmp.replace(/\\/g, "\\\\"))
  })

  it("場所を自動で探さない設定では、全体の決まりとスキルを調べない", async () => {
    const res = await service([{ summary: makeSessionSummary("local_g1", { title: "01_画面", group: G_APP }) }], null).get()
    expect(res.effects.global).toEqual({ status: "disabled", updatedAt: null })
    expect(res.effects.userSkills).toBeNull()
  })

  it("クラウドのフォルダを見分ける", () => {
    expect(isCloudFolder("C:\\Users\\x\\OneDrive\\work")).toBe(true)
    expect(isCloudFolder("C:\\Users\\x\\OneDrive - Company\\work")).toBe(true)
    expect(isCloudFolder("G:\\マイドライブ\\a")).toBe(true)
    expect(isCloudFolder("D:\\Dropbox\\a")).toBe(true)
    expect(isCloudFolder("C:\\work\\app")).toBe(false)
  })
})

describe("[RM-7, RM-8] グループをまたぐ頼み(A17)", () => {
  function inputs(): SourceInput[] {
    return [
      {
        summary: makeSessionSummary("local_h1", { title: "00_指揮役_情報", group: G_INFO }),
        receipts: [
          receipt("local_h2", { sentAt: NOW - 8 * 60 * MIN }),
          receipt("local_h3", { sentAt: NOW - 30 * MIN, readAt: NOW - 20 * MIN, repliedAt: NOW - 10 * MIN }),
          receipt("local_h4"),
          receipt("local_h2", { sentAt: NOW - 8 * 24 * 60 * MIN }),
          receipt("local_zz"),
        ],
      },
      { summary: makeSessionSummary("local_h2", { title: "00_指揮役_アプリ", group: G_APP }) },
      { summary: makeSessionSummary("local_h3", { title: "外の相談", group: null }) },
      { summary: makeSessionSummary("local_h4", { title: "01_情報の担当", group: G_INFO }) },
    ]
  }

  it("宛先が別のグループ(グループ外を含む)で、直近7日に送ったものだけを、新しい順に返す", async () => {
    const res = await service(inputs(), null).get()
    expect(res.crossGroup.map((r) => [r.fromId, r.toId, r.fromGroupId, r.toGroupId])).toEqual([
      ["local_h1", "local_h3", "g-info", null],
      ["local_h1", "local_h2", "g-info", "g-app"],
    ])
    expect(res.crossGroup[0].repliedAt).not.toBeNull()
    expect(res.groups.find((g) => g.id === "g-info")?.unansweredRequests).toBe(1)
  })

  it("要旨は、時刻が1分以内で宛先が合う送信の先頭20字。秘密らしい文字は伏せ、結べなければ null", () => {
    const sends = [
      { t: NOW - 61 * MIN, targets: ["local_h2"], summary: "遠い送信" },
      { t: NOW - 60 * MIN + 5_000, targets: ["00_指揮役_アプリ"], summary: "一覧の作り直しを頼みます" },
      { t: NOW - 60 * MIN, targets: ["local_other"], summary: "別の宛先" },
    ]
    expect(summaryOfReceipt(sends, NOW - 60 * MIN, "local_h2", "00_指揮役_アプリ")).toBe("一覧の作り直しを頼みます")
    expect(summaryOfReceipt(sends, NOW - 10 * 60 * MIN, "local_h2", "x")).toBeNull()
    expect(summaryOfReceipt(sends, null, "local_h2", "x")).toBeNull()
    const masked = summaryOfReceipt([{ t: NOW, targets: ["a"], summary: "Bearer abcdefghijklmnopqrstuvwxyz1234" }], NOW, "a", "x")
    expect(masked).not.toContain("abcdefghijklmnop")
  })
})

describe("返す項目", () => {
  it("API の項目は型に載せたものだけ(本文・パス・メッセージの本文を返さない)", async () => {
    const res: RelationsResponse = await service(
      [{ summary: makeSessionSummary("local_i1", { title: "01_画面", group: G_APP, cwd: "C:\\sample\\a", folderName: "a" }) }],
      null
    ).get()
    expect(Object.keys(res).sort()).toEqual(["configured", "crossGroup", "crossWindowMs", "effects", "generatedAt", "groups", "roleLabels", "sessions", "status"])
    expect(Object.keys(res.sessions[0]).sort()).toEqual([
      "branch",
      "folderName",
      "groupId",
      "id",
      "lastActivityAt",
      "orders",
      "reports",
      "role",
      "sameFolderIds",
      "spawnedFromId",
      "status",
      "title",
    ])
    expect(JSON.stringify(res)).not.toContain("C:\\\\sample")
  })
})
