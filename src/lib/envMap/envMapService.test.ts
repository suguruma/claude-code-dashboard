import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { EnvMapSource } from "@/lib/desktopSessionService"
import type { DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import { LAN_HEADER } from "@/lib/lanAccess/config"
import { EnvMapService, loadEnvMapConfig, type EnvMapConfigResult } from "./envMapService"
import { syntheticMap } from "./mapData.test"

const MARK = "ZZ_SECRET_MARK_c41"
const NOW = Date.UTC(2026, 10, 18, 3, 0)
let dir = ""

const summary = (id: string, extra: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary =>
  ({ id, title: "題名", cwd: null, isArchived: false, status: "idle", lastActivityAt: NOW - 1000, ...extra }) as DesktopSessionSummary

const line = (o: unknown) => JSON.stringify(o) + "\n"
let n = 0
const human = (text: string) => line({ type: "user", timestamp: new Date(NOW - 50000 + ++n).toISOString(), message: { content: text } })
const tool = (name: string, input: Record<string, unknown>) =>
  line({ type: "assistant", timestamp: new Date(NOW - 50000 + ++n).toISOString(), message: { content: [{ type: "tool_use", id: `t${n}`, name, input }] } })

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-envmap-"))
  const map = syntheticMap()
  ;(map.nodes as Record<string, unknown>[]).push({ id: "tool:cc-shell", layer: "tools", label: "シェル", kind: "", strength: "none", place: "", desc: "" })
  await fs.writeFile(path.join(dir, "map.json"), JSON.stringify(map))
  await fs.writeFile(path.join(dir, "a.jsonl"), human(`指示 ${MARK}`) + tool("Bash", { command: `rm ${MARK}` }))
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function service(config: EnvMapConfigResult, sources: EnvMapSource[]) {
  return new EnvMapService({ config: async () => config, sources: async () => sources, home: "C:\\Users\\tester", now: () => NOW })
}

describe("[A3] 設定とファイルの問題", () => {
  it("設定が無い・ファイルが無い・JSON が壊れている、で別の文", async () => {
    const none = await loadEnvMapConfig(dir)
    expect("problem" in none && none.problem.message).toContain("config/env-map.json")
    const missing = await service({ config: { mapPath: path.join(dir, "nothing.json") } }, []).get()
    expect(missing.problem?.kind).toBe("missing")
    await fs.writeFile(path.join(dir, "broken.json"), "{ not json")
    const broken = await service({ config: { mapPath: path.join(dir, "broken.json") } }, []).get()
    expect(broken.problem?.kind).toBe("broken")
    expect(new Set([none, missing.problem, broken.problem].map((p) => JSON.stringify(p))).size).toBe(3)
  })
})

describe("サービス", () => {
  const src = (id: string, extra: Partial<DesktopSessionSummary> = {}, paths = [path.join(dir, "a.jsonl")]): EnvMapSource => ({
    summary: summary(id, extra),
    taskId: null,
    transcriptPaths: paths,
  })

  it("直近30日に動いたセッションだけを新しい順に。既定は先頭", async () => {
    const s = service({ config: { mapPath: path.join(dir, "map.json") } }, [
      src("local_old", { lastActivityAt: NOW - 31 * 86400000 }),
      src("local_b", { lastActivityAt: NOW - 5000 }),
      src("local_a", { lastActivityAt: NOW - 1000 }),
      src("local_none", {}, []),
    ])
    const r = await s.get()
    expect(r.sessions.map((x) => x.id)).toEqual(["local_a", "local_b"])
    expect(r.defaultSession).toBe("local_a")
    expect(r.map?.nodes.length).toBe(95)
  })

  it("[A8] ルートに中身が入らず、書き足しは後ろだけを読み足す [A10]", async () => {
    const s = service({ config: { mapPath: path.join(dir, "map.json") } }, [src("local_a")])
    const first = await s.route("local_a")
    expect(first?.instructions).toHaveLength(1)
    expect(JSON.stringify(first)).not.toContain(MARK)
    const before = first!.bytes
    await fs.appendFile(path.join(dir, "a.jsonl"), tool("Bash", { command: "ls" }) + human("2つ目"))
    const second = await s.route("local_a")
    expect(second?.instructions.map((i) => i.calls)).toEqual([2, 0])
    expect(second!.bytes).toBeGreaterThan(before)
    expect(await s.route("local_unknown")).toBeNull()
  })
})

const sample = { generatedAt: 0, map: null, problem: null, sessions: [], defaultSession: null }
vi.mock("@/lib/envMap/envMapService", async (orig) => ({
  ...(await orig<typeof import("./envMapService")>()),
  getEnvMapService: () => ({ get: async () => sample, route: async () => null }),
}))

describe("[A9] LAN の印つきでは API が 403", () => {
  it("/api/env-map と /api/env-map/route", async () => {
    const headers = { [LAN_HEADER]: "1" }
    const a = await import("@/app/api/env-map/route")
    const b = await import("@/app/api/env-map/route/route")
    expect((await a.GET(new Request("http://127.0.0.1/api/env-map", { headers }))).status).toBe(403)
    expect((await b.GET(new Request("http://127.0.0.1/api/env-map/route?session=local_a", { headers }))).status).toBe(403)
    expect((await a.GET(new Request("http://127.0.0.1/api/env-map"))).status).toBe(200)
    expect((await b.GET(new Request("http://127.0.0.1/api/env-map/route?session=../x"))).status).toBe(400)
  })
})
