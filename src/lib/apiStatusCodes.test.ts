import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InvalidInputError } from "./errors"
import type { ProjectConfig } from "./types"

// API ルートの状態コード。エラーの文言ではなく、エラーの種類で決まること（400=入力の誤り・404=見つからない・409=衝突・500=想定外）。
// ルートの関数を直接呼ぶ（HTTP サーバーは使わない）。対象プロジェクトの決め方だけ差し替え、あとは本物の処理をテスト用の一時フォルダで動かす。
const state = vi.hoisted(() => ({ project: null as ProjectConfig | null }))
vi.mock("@/lib/apiHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apiHelpers")>()
  return {
    ...actual,
    resolveRequestProject: async () => {
      if (!state.project) throw new InvalidInputError("no project")
      return state.project
    },
  }
})

import { POST as backupsRestore } from "@/app/api/backups/restore/route"
import { POST as importApply } from "@/app/api/import/apply/route"
import { POST as importDiff } from "@/app/api/import/diff/route"
import { POST as refactorApply } from "@/app/api/refactor/apply/route"
import { POST as rulesCreate } from "@/app/api/rules/route"
import { DELETE as executionLogDelete } from "@/app/api/execution-log/[taskId]/route"
import { POST as suggestedRules } from "@/app/api/execution-log/[taskId]/suggested-rules/route"
import { PATCH as rulePatch } from "@/app/api/rules/[id]/route"
import { POST as rulesReorder } from "@/app/api/rules/reorder/route"
import { POST as skillArchive } from "@/app/api/skills/[dirName]/archive/route"
import { POST as skillDisable } from "@/app/api/skills/[dirName]/disable/route"
import { POST as skillEnable } from "@/app/api/skills/[dirName]/enable/route"
import { POST as skillRename } from "@/app/api/skills/[dirName]/rename/route"
import { POST as skillRestore } from "@/app/api/skills/[dirName]/restore/route"
import { DELETE as skillDelete, PATCH as skillPatch } from "@/app/api/skills/[dirName]/route"
import { POST as skillCreate } from "@/app/api/skills/route"
import { POST as trashRestore } from "@/app/api/skills-trash/route"

const cleanupDirs: string[] = []

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** 本文を、JSON にせず、文字列のまま渡す（壊れた JSON を送るため） */
function rawRequest(method: string, body: string): NextRequest {
  return new NextRequest("http://localhost/api/test", { method, headers: { "content-type": "application/json" }, body })
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) }
}

async function writeSkill(project: ProjectConfig, dirName: string, extra = "") {
  const dir = path.join(project.path, "skills", dirName)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${dirName}\ndescription: desc\n${extra}---\n\n本文\n`)
}

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-api-status-test-"))
  cleanupDirs.push(dir)
  state.project = { id: "test", name: "test", path: dir }
  await writeSkill(state.project, "sample-skill")
  await writeSkill(state.project, "other-skill")
})

afterEach(async () => {
  state.project = null
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("スキルの API", () => {
  it("作成: スキル名が不正 → 400（以前は文言に「不正な」を含まず 500 だった）／重複 → 409／対象モデルが . だけ → 400／正常 → 201", async () => {
    const create = (body: object) => skillCreate(request("POST", body))
    expect((await create({ dirName: "bad name!", description: "d" })).status).toBe(400)
    expect((await create({ dirName: "sample-skill", description: "d" })).status).toBe(409)
    expect((await create({ dirName: "new-skill", description: "d", targetModel: ".." })).status).toBe(400)
    expect((await create({ dirName: "new-skill", description: "d" })).status).toBe(201)
  })

  it("更新・削除: 見つからない → 404／対象モデルが . だけ → 400", async () => {
    const patch = (dirName: string, body: object) => skillPatch(request("PATCH", body), params({ dirName }))
    expect((await patch("nothing", { description: "x" })).status).toBe(404)
    expect((await patch("sample-skill", { targetModel: "..." })).status).toBe(400)
    expect((await patch("sample-skill", { description: "x" })).status).toBe(200)
    expect((await skillDelete(request("DELETE"), params({ dirName: "nothing" }))).status).toBe(404)
  })

  it("名前の変更: 見つからない → 404／新しい名前が不正 → 400／新しい名前が既にある → 409", async () => {
    const rename = (dirName: string, newDirName: string) =>
      skillRename(request("POST", { newDirName }), params({ dirName }))
    expect((await rename("nothing", "renamed")).status).toBe(404)
    expect((await rename("sample-skill", "bad name!")).status).toBe(400)
    expect((await rename("sample-skill", "other-skill")).status).toBe(409)
    expect((await rename("sample-skill", "renamed")).status).toBe(200)
  })

  it("無効化・有効化: 見つからない → 404／すでにその状態 → 409（以前は 500）", async () => {
    const call = (fn: typeof skillDisable, dirName: string) => fn(request("POST"), params({ dirName }))
    expect((await call(skillDisable, "nothing")).status).toBe(404)
    expect((await call(skillEnable, "nothing")).status).toBe(404)
    expect((await call(skillEnable, "sample-skill")).status).toBe(409)
    expect((await call(skillDisable, "sample-skill")).status).toBe(200)
    expect((await call(skillDisable, "sample-skill")).status).toBe(409)
    expect((await call(skillEnable, "sample-skill")).status).toBe(200)
  })

  it("退避(アーカイブ): 見つからない → 404／スキル名がフォルダを指さない → 400", async () => {
    const archive = (dirName: string) => skillArchive(request("POST"), params({ dirName }))
    expect((await archive("nothing")).status).toBe(404)
    expect((await archive("..")).status).toBe(400)
    expect((await archive("a/b")).status).toBe(400)
    expect((await archive("sample-skill")).status).toBe(200)
  })

  it("切り替え(restore): モデル名が . だけ → 400／. を含むパスに置き換わる名前・無いモデル・無いスキル → 404", async () => {
    await writeSkill(state.project!, "sample-skill", "target-model: Model A\n")
    expect((await skillArchive(request("POST"), params({ dirName: "sample-skill" }))).status).toBe(200)
    const restore = (dirName: string, model: unknown) => skillRestore(request("POST", { model }), params({ dirName }))
    for (const model of [".", "..", "...", " .. "]) {
      expect((await restore("sample-skill", model)).status).toBe(400)
    }
    expect((await restore("sample-skill", "./..")).status).toBe(404)
    expect((await restore("sample-skill", "No Such Model")).status).toBe(404)
    expect((await restore("nothing", "Model A")).status).toBe(404)
    expect((await restore("sample-skill", 123)).status).toBe(400)
  })
})

describe("削除済みスキル・バックアップの API", () => {
  it("削除済みスキルの復元: id が不正 → 400／見つからない → 404", async () => {
    const restore = (id: string) => trashRestore(request("POST", { id }))
    expect((await restore("../x")).status).toBe(400)
    expect((await restore("no-such-id")).status).toBe(404)
  })

  it("バックアップの復元: ファイル名・場所が不正 → 400／見つからない → 404（以前は 400）", async () => {
    const restore = (body: object) => backupsRestore(request("POST", body))
    expect((await restore({ fileName: "../x" })).status).toBe(400)
    expect((await restore({ fileName: "a.ccd-backup.1", kind: "claude-json", location: "skills/x" })).status).toBe(400)
    expect((await restore({ fileName: "nothing.ccd-backup.1", kind: "ccd" })).status).toBe(404)
    expect((await restore({ fileName: "nothing.json.bak" })).status).toBe(404)
  })
})

describe("ルール・実行ログの API", () => {
  it("ルールの更新: 見つからない → 404／並び替えで一覧が現在の内容と合わない → 409", async () => {
    await fs.writeFile(path.join(state.project!.path, "CLAUDE.md"), "## 見出しA\n\n本文A\n\n## 見出しB\n\n本文B\n")
    expect((await rulePatch(request("PATCH", { content: "x" }), params({ id: "no-such-rule" }))).status).toBe(404)
    expect((await rulesReorder(request("POST", { orderedIds: ["only-one"] }))).status).toBe(409)
    expect((await rulesReorder(request("POST", { orderedIds: "x" }))).status).toBe(400)
  })

  it("実行ログの削除・ルール候補の保存: 該当のタスクログがない → 404", async () => {
    expect((await executionLogDelete(request("DELETE"), params({ taskId: "task_x" }))).status).toBe(404)
    expect((await suggestedRules(request("POST", {}), params({ taskId: "task_x" }))).status).toBe(404)
  })
})

describe("リクエストの本文", () => {
  const BROKEN = ["{", "not json", "null", "[]", "5", '"text"']

  it("壊れた JSON・オブジェクトでない本文は、本文を読むどのルートでも 400（500 にならない）", async () => {
    const calls: [string, (body: string) => Promise<Response>][] = [
      ["POST /api/skills", (b) => skillCreate(rawRequest("POST", b))],
      ["PATCH /api/skills/[dirName]", (b) => skillPatch(rawRequest("PATCH", b), params({ dirName: "sample-skill" }))],
      ["POST /api/skills/[dirName]/rename", (b) => skillRename(rawRequest("POST", b), params({ dirName: "sample-skill" }))],
      ["POST /api/skills/[dirName]/restore", (b) => skillRestore(rawRequest("POST", b), params({ dirName: "sample-skill" }))],
      ["POST /api/skills-trash", (b) => trashRestore(rawRequest("POST", b))],
      ["POST /api/backups/restore", (b) => backupsRestore(rawRequest("POST", b))],
      ["POST /api/rules", (b) => rulesCreate(rawRequest("POST", b))],
      ["PATCH /api/rules/[id]", (b) => rulePatch(rawRequest("PATCH", b), params({ id: "x" }))],
      ["POST /api/rules/reorder", (b) => rulesReorder(rawRequest("POST", b))],
      ["POST /api/import/diff", (b) => importDiff(rawRequest("POST", b))],
      ["POST /api/import/apply", (b) => importApply(rawRequest("POST", b))],
      ["POST /api/refactor/apply", (b) => refactorApply(rawRequest("POST", b))],
    ]
    for (const [name, call] of calls) {
      for (const body of BROKEN) {
        const res = await call(body)
        expect(res.status, `${name} ← ${JSON.stringify(body)}`).toBe(400)
      }
    }
  })

  it("本文の誤りの応答は { error } だけで、本文の内容も解析エラーの内容も含まない", async () => {
    const res = await skillCreate(rawRequest("POST", '{"dirName": SECRET-BODY-TEXT'))
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: "リクエストの本文を JSON として読めません" })
    expect(text).not.toContain("SECRET-BODY-TEXT")
  })

  it("本文が正しければ、これまでどおり動く（作成は 201。形式の合わないインポートのバンドルは、検証の結果として 400）", async () => {
    expect((await skillCreate(request("POST", { dirName: "brand-new", description: "d" }))).status).toBe(201)
    expect((await importDiff(request("POST", { version: 999, rules: [], skills: [] }))).status).toBe(400)
  })
})

describe("ソースの検査", () => {
  async function routeFiles(dir: string): Promise<string[]> {
    const out: string[] = []
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...(await routeFiles(full)))
      else if (entry.name === "route.ts") out.push(full)
    }
    return out
  }

  it("API ルートに、エラーの文言(message)で状態コードを決める分岐がない。ルート固有の handleError も置かない", async () => {
    const files = await routeFiles(path.join(process.cwd(), "src", "app", "api"))
    expect(files.length).toBeGreaterThan(20)
    const offenders: string[] = []
    for (const file of files) {
      const source = await fs.readFile(file, "utf-8")
      if (/\bmessage\.(includes|startsWith|endsWith|match)\(|\bmessage\s*===|\.message\.(includes|startsWith|match)\(|function handleError\b/.test(source)) {
        offenders.push(path.relative(process.cwd(), file))
      }
    }
    expect(offenders).toEqual([])
  })
})


describe("ソースの検査（本文と想定外のエラー）", () => {
  async function routeSources(): Promise<[string, string][]> {
    const out: [string, string][] = []
    const walk = async (dir: string) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (entry.name === "route.ts") out.push([path.relative(process.cwd(), full).split(path.sep).join("/"), await fs.readFile(full, "utf-8")])
      }
    }
    await walk(path.join(process.cwd(), "src", "app", "api"))
    return out
  }

  it("想定外のエラーの状態コードを変える逃げ道（fallbackStatus）が、ルートにも共通の関数にも無い", async () => {
    const offenders = (await routeSources()).filter(([, source]) => source.includes("fallbackStatus")).map(([file]) => file)
    expect(offenders).toEqual([])
    const helper = await fs.readFile(path.join(process.cwd(), "src", "lib", "apiHelpers.ts"), "utf-8")
    expect(helper).not.toContain("fallbackStatus")
  })

  it("ルートが req.json() を直接呼ばない（本文は readJsonBody で読む）。例外は、固定の文言で独自に検査している desktop-sessions/settings だけ", async () => {
    const offenders = (await routeSources()).filter(([, source]) => /\breq\.json\(/.test(source)).map(([file]) => file)
    expect(offenders).toEqual(["src/app/api/desktop-sessions/settings/route.ts"])
  })
})
