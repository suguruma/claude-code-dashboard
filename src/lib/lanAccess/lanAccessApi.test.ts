import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DELETE as deviceDelete, PATCH as devicePatch } from "@/app/api/lan-access/devices/[id]/route"
import { POST as pairingPost } from "@/app/api/lan-access/pairing/route"
import { GET as lanGet, PUT as lanPut } from "@/app/api/lan-access/route"
import { POST as notifyPost } from "@/app/api/desktop-sessions/settings/route"
import { DesktopSessionService } from "../desktopSessionService"
import { FlowService } from "../flowService"
import { HousekeepingService } from "../housekeepingService"
import { UsageService } from "../usageService"
import { LAN_HEADER, lanFiles, writeLanStatus } from "./config"
import { loadDevices, registerDevice } from "./devices"
import { lastSegment, redactForLan } from "./redact"

interface SampleModule {
  makeOrgChartSample: (
    outDir: string,
    options?: { now?: number }
  ) => { dataDir: string; projectsRoot: string; write: () => Promise<void>; groups: { a: string; b: string }; ids: Record<string, string> }
}

const cleanup: string[] = []
let savedDataDir: string | undefined
let root = ""

beforeEach(async () => {
  savedDataDir = process.env.CCD_DATA_DIR
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-lan-api-test-"))
  cleanup.push(root)
  process.env.CCD_DATA_DIR = root
})

afterEach(async () => {
  if (savedDataDir === undefined) delete process.env.CCD_DATA_DIR
  else process.env.CCD_DATA_DIR = savedDataDir
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

function req(method: string, url: string, body?: unknown, viaLan = false): Request {
  const headers: Record<string, string> = { host: "127.0.0.1:3000" }
  if (body !== undefined) headers["content-type"] = "application/json"
  if (viaLan) headers[LAN_HEADER] = "1"
  return new Request(`http://127.0.0.1:3000${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe("スマホから見る：管理の API は PC からだけ", () => {
  it("入り口を通った要求（x-ccd-via-lan 付き）は、管理の API と通知の書き込みで 403", async () => {
    expect((await lanGet(req("GET", "/api/lan-access", undefined, true))).status).toBe(403)
    expect((await lanPut(req("PUT", "/api/lan-access", { enabled: true }, true))).status).toBe(403)
    expect((await pairingPost(req("POST", "/api/lan-access/pairing", undefined, true))).status).toBe(403)
    expect((await devicePatch(req("PATCH", "/api/lan-access/devices/x", { name: "a" }, true), params("x"))).status).toBe(403)
    expect((await deviceDelete(req("DELETE", "/api/lan-access/devices/x", undefined, true), params("x"))).status).toBe(403)
    const notify = new Request("http://127.0.0.1:3000/api/desktop-sessions/settings", {
      method: "POST",
      headers: { "content-type": "application/json", [LAN_HEADER]: "1" },
      body: JSON.stringify({ notifications: true }),
    })
    expect((await notifyPost(notify as never)).status).toBe(403)
    // 設定のファイルは作られていない(オンにならない)
    await expect(fs.access(lanFiles(root).settings)).rejects.toThrow()
  })

  it("PC からは、既定はオフ。オンにでき、待ち受けていないあいだは登録コードを出さない（409）", async () => {
    const first = await (await lanGet(req("GET", "/api/lan-access"))).json()
    expect(first.enabled).toBe(false)
    expect(first.status.state).toBe("off")
    const on = await lanPut(req("PUT", "/api/lan-access", { enabled: true }))
    expect(on.status).toBe(200)
    expect((await on.json()).enabled).toBe(true)
    expect((await lanPut(req("PUT", "/api/lan-access", { enabled: "yes" }))).status).toBe(400)
    expect((await pairingPost(req("POST", "/api/lan-access/pairing"))).status).toBe(409)
  })

  it("待ち受け中なら、登録コード・URL・QR（SVG）を返す。一覧の応答には、コードの平文も鍵のハッシュも無い", async () => {
    await lanPut(req("PUT", "/api/lan-access", { enabled: true }))
    await writeLanStatus({ state: "listening", urls: ["http://192.168.10.5:38418"], error: null, updatedAt: Date.now() }, lanFiles(root))
    const res = await pairingPost(req("POST", "/api/lan-access/pairing"))
    expect(res.status).toBe(200)
    const issued = await res.json()
    expect(issued.code).toMatch(/^[A-Z2-9]{8}$/)
    expect(issued.urls).toEqual([`http://192.168.10.5:38418/pair?code=${issued.code}`])
    expect(issued.qrSvg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/)
    expect(issued.qrSvg).not.toMatch(/<script|href=/i)

    await registerDevice(lanFiles(root).devices, "iPhone・Safari", Date.now())
    const overviewText = await (await lanGet(req("GET", "/api/lan-access"))).text()
    expect(overviewText).not.toContain(issued.code)
    expect(overviewText).not.toContain("keyHash")
    const overview = JSON.parse(overviewText)
    expect(overview.pairing.active).toBe(true)
    expect(overview.devices).toHaveLength(1)
  })

  it("端末の名前の変更と取り消し", async () => {
    const r = await registerDevice(lanFiles(root).devices, "端末", Date.now())
    if (!r.ok) throw new Error("登録できない")
    expect((await devicePatch(req("PATCH", `/api/lan-access/devices/${r.device.id}`, { name: "台所" }), params(r.device.id))).status).toBe(200)
    expect((await loadDevices(lanFiles(root).devices))[0].name).toBe("台所")
    expect((await deviceDelete(req("DELETE", `/api/lan-access/devices/${r.device.id}`), params(r.device.id))).status).toBe(200)
    expect(await loadDevices(lanFiles(root).devices)).toHaveLength(0)
    expect((await deviceDelete(req("DELETE", `/api/lan-access/devices/${r.device.id}`), params(r.device.id))).status).toBe(404)
    expect((await deviceDelete(req("DELETE", "/api/lan-access/devices/../x"), params("../x"))).status).toBe(400)
  })
})

/** フォルダのパスらしい文字列(ドライブ・UNC・\・ホームの下の POSIX のパス) */
const PATH_LIKE = /[A-Za-z]:[\\/]|\\\\|\\|\/(Users|home|mnt|root)\//

describe("スマホへ返す API の応答から、フォルダのパスを隠す（Q5）", () => {
  it("作業フォルダとデータの場所は最後の名前だけ。projectDirName は null。文の中の絶対パスも隠す", () => {
    const out = redactForLan({
      cwd: "C:\\Users\\someone\\work\\app",
      dataLocation: { path: "C:\\Users\\someone\\AppData\\Roaming\\Claude", origin: "auto" },
      projectDirName: "C--Users-someone-work-app",
      warnings: ["読めないファイルがあります: C:\\Users\\someone\\x.json", "/home/someone/.claude/projects を読めません"],
      title: "送信 3/10 と a/b の比較",
      nested: [{ cwd: "/Users/someone/repo" }],
    })
    expect(out.cwd).toBe("app")
    expect(out.dataLocation.path).toBe("Claude")
    expect(out.projectDirName).toBeNull()
    expect(out.warnings[0]).toBe("読めないファイルがあります: x.json")
    expect(out.warnings[1]).toBe("projects を読めません")
    expect(out.title).toBe("送信 3/10 と a/b の比較")
    expect(out.nested[0].cwd).toBe("repo")
    expect(JSON.stringify(out)).not.toMatch(PATH_LIKE)
    expect(lastSegment("C:\\")).toBe("")
  })

  it("合成データ：入り口の経由の6つの API と同じ応答（一覧・詳細・組織図・整理・利用上限・通知の設定）に、フォルダのパスが残らない", async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(process.cwd(), "scripts", "make-org-chart-sample.mjs")).href)) as SampleModule
    const out = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-lan-redact-test-"))
    cleanup.push(out)
    const now = Date.now()
    const sample = mod.makeOrgChartSample(path.join(out, "sample"), { now })
    await sample.write()
    const sessions = new DesktopSessionService({ dataDir: sample.dataDir, projectsRoot: sample.projectsRoot, now: () => now })
    const flow = new FlowService(sessions, { now: () => now })
    const usage = new UsageService({ projectsRoot: sample.projectsRoot, now: () => now })
    const housekeeping = new HousekeepingService(sessions, flow, { now: () => now, usage: async () => null })

    const list = await sessions.list()
    // 合成データの作業フォルダは、隠す前は絶対パス(`C:\sample\...`)
    expect(JSON.stringify(list)).toMatch(PATH_LIKE)
    const responses = [
      list,
      await sessions.detail(list.sessions[0].id),
      await flow.build(sample.groups.a),
      await housekeeping.get(),
      await usage.get(),
      { notifications: false },
    ]
    for (const [i, r] of responses.entries()) {
      expect(r, `応答${i}`).not.toBeNull()
      expect(JSON.stringify(redactForLan(r)), `応答${i}`).not.toMatch(PATH_LIKE)
    }
  })

  it("合成データ：作業フォルダがホームのフォルダそのもののセッションでも、入り口の経由の一覧・詳細にユーザー名が出ない(PC はそのまま)", async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(process.cwd(), "scripts", "make-org-chart-sample.mjs")).href)) as SampleModule
    const out = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-lan-home-test-"))
    cleanup.push(out)
    const now = Date.now()
    const sample = mod.makeOrgChartSample(path.join(out, "sample"), { now })
    await sample.write()
    // 1つのセッションの作業フォルダを、合成のホームのフォルダ(C:\Users\<名前>)にする
    const user = "synthhomeuser"
    const home = ["C:", "Users", user].join("\\")
    const sessionFiles: string[] = []
    const collect = async (dir: string) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) await collect(p)
        else if (p.includes("claude-code-sessions") && e.name.endsWith(".json")) sessionFiles.push(p)
      }
    }
    await collect(sample.dataDir)
    const target = sessionFiles.sort()[0]
    const meta = JSON.parse(await fs.readFile(target, "utf-8")) as { sessionId: string; cwd: string; originCwd: string }
    await fs.writeFile(target, JSON.stringify({ ...meta, cwd: home, originCwd: home }), "utf-8")

    const sessions = new DesktopSessionService({ dataDir: sample.dataDir, projectsRoot: sample.projectsRoot, now: () => now })
    const list = await sessions.list()
    const raw = list.sessions.find((s) => s.id === meta.sessionId)
    expect(raw?.cwd).toBe(home)
    // PC(ループバック)の応答は変えない
    expect(raw?.folderName).toBe(user)
    const detail = await sessions.detail(meta.sessionId)
    expect(detail?.folderName).toBe(user)

    const lanList = redactForLan(list)
    const lanDetail = redactForLan(detail)
    expect(JSON.stringify(lanList)).not.toContain(user)
    expect(JSON.stringify(lanDetail)).not.toContain(user)
    const lanRow = lanList.sessions.find((s) => s.id === meta.sessionId)
    expect(lanRow).toMatchObject({ cwd: "~", folderName: "~" })
    // スマホの詳細のシートの「作業フォルダ」は、この値(folderName)を出す
    expect(lanDetail).toMatchObject({ cwd: "~", folderName: "~" })
  })

  it("6つの読み取りの API は、応答を lanAwareJson で返す（入り口の経由ならパスを隠す）", async () => {
    const files = [
      "src/app/api/desktop-sessions/route.ts",
      "src/app/api/desktop-sessions/[id]/route.ts",
      "src/app/api/desktop-sessions/flow/route.ts",
      "src/app/api/desktop-sessions/housekeeping/route.ts",
      "src/app/api/desktop-sessions/settings/route.ts",
      "src/app/api/usage/route.ts",
    ]
    for (const f of files) {
      const src = await fs.readFile(path.join(process.cwd(), f), "utf-8")
      // GET の本体だけを見る(通知の設定の POST は PC からだけで、入り口を通らない)
      const get = src.slice(src.indexOf("export async function GET")).split(/\nexport async function /)[0]
      expect(get, f).toContain("lanAwareJson(req,")
      // 成功の応答を NextResponse.json で直接返していない(エラーの応答は固定の文言なので、そのままでよい)
      const okReturns = get.split("\n").filter((l) => /return NextResponse\.json\(/.test(l) && !/error/.test(l))
      expect(okReturns, f).toEqual([])
    }
  })
})
