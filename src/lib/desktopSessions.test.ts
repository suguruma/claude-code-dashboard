import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  MetaCache,
  extractSidebarPrefs,
  indexTranscripts,
  listMetaFiles,
  projectMeta,
  readSidebarPrefs,
  resolveDesktopDataDir,
} from "./desktopSessions"
import {
  NEEDS_ACTION_HEAD,
  NEEDS_ACTION_TAIL,
  SENTINEL,
  fakeCliId,
  fakeSessionId,
  makeDesktopFixture,
  makeMeta,
  writeDesktopConfigs,
  writeMeta,
  writeTranscript,
} from "./desktopFixtures"

const cleanup: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-desktop-test-"))
  cleanup.push(root)
  return makeDesktopFixture(root)
}

describe("projectMeta(許可リスト方式の射影、S3)", () => {
  it("表示に必要な項目だけを返し、返してはいけない項目は戻り値のどこにも残らない", () => {
    const meta = projectMeta(makeMeta({ n: 1, category: "blocked", error: `err ${SENTINEL}` }))
    expect(meta).not.toBeNull()
    expect(JSON.stringify(meta)).not.toContain(SENTINEL)
    expect(Object.keys(meta!).sort()).toEqual(
      [
        "cliSessionId",
        "completedTurns",
        "createdAt",
        "cwd",
        "effort",
        "errorAt",
        "errorExcerpt",
        "hasError",
        "id",
        "isArchived",
        "isRoutine",
        "isSideChat",
        "lastActivityAt",
        "lastAssistantUuid",
        "model",
        "needsAction",
        "needsActionExcerpt",
        "needsActionText",
        "peerReceipts",
        "permissionMode",
        "spawnedFromId",
        "statusCategory",
        "summaryFor",
        "summaryWordKind",
        "title",
        "writtenBranch",
      ].sort()
    )
    expect(meta).toMatchObject({ id: fakeSessionId(1), statusCategory: "blocked", needsAction: true, hasError: true })
  })

  it("要対応の内容の抜粋は先頭60文字。全文は次にやる判断(⑬)のための項目にだけ持ち、状態の説明・ターンのまとめは保持しない", () => {
    const meta = projectMeta(makeMeta({ n: 1, category: "blocked" }))
    expect(meta?.needsActionExcerpt).toBe(`${NEEDS_ACTION_HEAD}${"あ".repeat(60 - NEEDS_ACTION_HEAD.length)}…`)
    expect(meta?.needsActionExcerpt?.replace("…", "").length).toBe(60)
    expect(meta?.needsActionExcerpt).not.toContain(NEEDS_ACTION_TAIL)
    expect(meta?.needsActionText).toContain(NEEDS_ACTION_TAIL)
    expect(JSON.stringify(meta)).not.toContain(SENTINEL)
    // 要対応でないセッションには付かない
    expect(projectMeta(makeMeta({ n: 2, category: "completed" }))?.needsActionExcerpt).toBeNull()
    expect(projectMeta(makeMeta({ n: 3 }))?.needsActionExcerpt).toBeNull()
  })

  it("エラーの記録時刻(errorAt)を取り込む。無ければ null", () => {
    expect(projectMeta(makeMeta({ n: 1, error: "e", errorAt: 123 }))).toMatchObject({ hasError: true, errorAt: 123 })
    expect(projectMeta(makeMeta({ n: 2, error: "e" }))?.errorAt).toBeNull()
  })

  it("すべてのキーを省略可能として読み、不明な分類は null にする", () => {
    expect(projectMeta({ sessionId: "local_x" })).toMatchObject({
      id: "local_x",
      cliSessionId: null,
      statusCategory: null,
      needsAction: false,
      isArchived: false,
      hasError: false,
      title: "",
    })
    expect(projectMeta({ sessionId: "local_x", postTurnSummary: { status_category: "something_new" } })?.statusCategory).toBeNull()
  })

  it("セッションIDが無い・オブジェクトでない値は null", () => {
    expect(projectMeta({})).toBeNull()
    expect(projectMeta(null)).toBeNull()
    expect(projectMeta("text")).toBeNull()
  })

  it("spawnedFrom からは、local_ の形に合う sessionId だけを取り込む。taskId・title・name など、ほかの項目は残らない", () => {
    const meta = projectMeta(makeMeta({ n: 1, spawnedFromId: fakeSessionId(7) }))
    expect(meta?.spawnedFromId).toBe(fakeSessionId(7))
    expect(JSON.stringify(meta)).not.toContain(SENTINEL)
    // spawnedFrom が無いセッション
    expect(projectMeta(makeMeta({ n: 2 }))?.spawnedFromId).toBeNull()
    // 形に合わない値・文字列でない値・sessionId が無い spawnedFrom は取り込まない
    for (const bad of ["not-a-session", "", "local_", "local_a b", "../local_x", 7, null, { id: "x" }]) {
      expect(projectMeta(makeMeta({ n: 3, spawnedFromId: bad }))?.spawnedFromId).toBeNull()
    }
    expect(projectMeta({ sessionId: "local_x", spawnedFrom: "local_y" })?.spawnedFromId).toBeNull()
    expect(projectMeta({ sessionId: "local_x", spawnedFrom: { taskId: "t" } })?.spawnedFromId).toBeNull()
  })

  it("サイドチャットは spawnedFrom の btw と userFork が両方 true のものだけ。sideSession だけ(作業用の子)では判定しない", () => {
    expect(projectMeta(makeMeta({ n: 1, spawnedFromId: fakeSessionId(7), sideChat: true }))?.isSideChat).toBe(true)
    expect(projectMeta(makeMeta({ n: 2, spawnedFromId: fakeSessionId(7) }))?.isSideChat).toBe(false)
    expect(projectMeta(makeMeta({ n: 3 }))?.isSideChat).toBe(false)
    const half = (extra: Record<string, unknown>) =>
      projectMeta({ sessionId: "local_x", spawnedFrom: { sessionId: "local_y", sideSession: true, ...extra } })?.isSideChat
    expect(half({ btw: true })).toBe(false)
    expect(half({ userFork: true })).toBe(false)
    expect(half({ btw: "true", userFork: true })).toBe(false)
    expect(half({ btw: true, userFork: true })).toBe(true)
    // spawnedFrom の外にある同名の項目は見ない
    expect(projectMeta({ sessionId: "local_x", btw: true, userFork: true })?.isSideChat).toBe(false)
  })

  it("定期実行のセッションと、要対応の文が空のセッションを区別する", () => {
    expect(projectMeta(makeMeta({ n: 1, scheduledTaskId: "task" }))?.isRoutine).toBe(true)
    expect(projectMeta(makeMeta({ n: 2, category: "completed" }))?.needsAction).toBe(false)
  })
})

describe("extractSidebarPrefs(S2)", () => {
  const scope = "acct/org"

  it("グループ名・割り当て・ピン留めだけを取り出す", () => {
    const prefs = extractSidebarPrefs({
      "dframe-code-sections": {
        [scope]: {
          sections: [
            { id: "pinned", kind: "pinned", name: "ピン留め", order: 0 },
            { id: "cg-1", kind: "manual", name: "設計", order: 2 },
            { id: "cg-2", kind: "manual", name: "実装", order: 1 },
            { id: "sessions", kind: "sessions", name: "その他", order: 9 },
          ],
        },
      },
      "dframe-group-scopes": {
        [scope]: {
          groups: [
            { id: "cg-1", name: "設計" },
            { id: "cg-3", name: "sectionsに無いグループ" },
          ],
          assignments: { "code:local_a": "cg-1", "code:local_b": "cg-2" },
        },
      },
      "starred-local-code-sessions": ["code:local_a"],
      "dframe-local-slice": { pinnedOrder: ["local_b"] },
      "unrelated-pref": { secret: SENTINEL },
    })
    expect([...prefs.groups.values()].map((g) => g.name).sort()).toEqual(["実装", "設計", "sectionsに無いグループ"].sort())
    expect(prefs.groups.get("cg-1")).toEqual({ id: "cg-1", name: "設計", order: 2 })
    expect(prefs.assignments.get("local_a")).toBe("cg-1")
    expect(prefs.assignments.get("local_b")).toBe("cg-2")
    // ピン留めは starred-local-code-sessions だけで判定する。pinnedOrder は並び順の情報で、ピン留めを意味しない
    expect([...prefs.pinned]).toEqual(["local_a"])
    expect(JSON.stringify([...prefs.groups.values(), [...prefs.assignments], [...prefs.pinned]])).not.toContain(SENTINEL)
  })

  it("値が文字列にエンコードされていても読める。想定外の形式では空の結果を返す", () => {
    const encoded = extractSidebarPrefs({
      "dframe-group-scopes": JSON.stringify({ [scope]: { assignments: { "code:local_a": "cg-1" } } }),
    })
    expect(encoded.assignments.get("local_a")).toBe("cg-1")

    for (const garbage of [null, undefined, 42, "not json", [], { "dframe-code-sections": [1, 2] }]) {
      const result = extractSidebarPrefs(garbage)
      expect(result.groups.size).toBe(0)
      expect(result.assignments.size).toBe(0)
    }
  })
})

describe("readSidebarPrefs", () => {
  it("mcpServers など無関係な内容を結果に残さない", async () => {
    const fx = await fixture()
    await writeDesktopConfigs(fx, {
      groups: [{ id: "cg-1", name: "設計", order: 1 }],
      assignments: { [`code:${fakeSessionId(1)}`]: "cg-1" },
    })
    const prefs = await readSidebarPrefs(fx.dataDir)
    expect(prefs?.assignments.get(fakeSessionId(1))).toBe("cg-1")
    expect(JSON.stringify([...prefs!.groups.values(), [...prefs!.assignments], [...prefs!.pinned]])).not.toContain(SENTINEL)
  })

  it("ファイルが無い・JSONが壊れているときは null を返し、例外にファイルの内容を含めない", async () => {
    const fx = await fixture()
    expect(await readSidebarPrefs(fx.dataDir)).toBeNull()
    await fs.writeFile(path.join(fx.dataDir, "claude_desktop_config.json"), `{"mcpServers":{"env":{"KEY":"${SENTINEL}" BROKEN`)
    await expect(readSidebarPrefs(fx.dataDir)).resolves.toBeNull()
  })
})

describe("メタデータの列挙と読み取り", () => {
  it("local_*.json だけを拾い、付随ファイルと config.json は読まない(S1)", async () => {
    const fx = await fixture()
    await writeMeta(fx, makeMeta({ n: 1 }))
    await writeMeta(fx, makeMeta({ n: 2 }))
    await fs.writeFile(path.join(fx.sessionsDir, "archived-sessions.idx"), "x")
    await fs.writeFile(path.join(fx.sessionsDir, "deleted_00000000"), "x")
    await fs.writeFile(path.join(fx.sessionsDir, "scheduled-tasks.json"), "{}")
    await writeDesktopConfigs(fx)

    const readSpy = vi.spyOn(fs, "readFile")
    const files = await listMetaFiles(fx.dataDir)
    expect(files).toHaveLength(2)

    const read = await new MetaCache().read(fx.dataDir)
    expect(read.metas.map((m) => m.id).sort()).toEqual([fakeSessionId(1), fakeSessionId(2)])
    const readPaths = readSpy.mock.calls.map((c) => String(c[0]))
    expect(readPaths).toHaveLength(2)
    expect(readPaths.every((p) => path.basename(p).startsWith("local_"))).toBe(true)
    expect(readPaths.some((p) => path.basename(p) === "config.json")).toBe(false)
  })

  it("更新時刻が変わっていないファイルは読み直さない", async () => {
    const fx = await fixture()
    await writeMeta(fx, makeMeta({ n: 1 }))
    await writeMeta(fx, makeMeta({ n: 2 }))
    const cache = new MetaCache()
    await cache.read(fx.dataDir)

    const readSpy = vi.spyOn(fs, "readFile")
    await cache.read(fx.dataDir)
    expect(readSpy).not.toHaveBeenCalled()

    const file = await writeMeta(fx, makeMeta({ n: 1, title: "更新後" }))
    const future = new Date(Date.now() + 5000)
    await fs.utimes(file, future, future)
    const read = await cache.read(fx.dataDir)
    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(read.metas.find((m) => m.id === fakeSessionId(1))?.title).toBe("更新後")
  })

  it("解析に失敗したら前回の値を使い、次の取得で読み直す(S4)", async () => {
    const fx = await fixture()
    const file = await writeMeta(fx, makeMeta({ n: 1, title: "前回の値" }))
    const cache = new MetaCache()
    await cache.read(fx.dataDir)

    await fs.writeFile(file, `{"sessionId": "${fakeSessionId(1)}", "promptAppendSnapshot": "${SENTINEL}" BROKEN`)
    const future = new Date(Date.now() + 5000)
    await fs.utimes(file, future, future)
    const broken = await cache.read(fx.dataDir)
    expect(broken.failedCount).toBe(1)
    expect(broken.metas[0].title).toBe("前回の値")

    await writeMeta(fx, makeMeta({ n: 1, title: "復旧後" }))
    const later = new Date(Date.now() + 10_000)
    await fs.utimes(file, later, later)
    const recovered = await cache.read(fx.dataDir)
    expect(recovered.failedCount).toBe(0)
    expect(recovered.metas[0].title).toBe("復旧後")
  })

  it("削除されたファイルは一覧から消える", async () => {
    const fx = await fixture()
    const file = await writeMeta(fx, makeMeta({ n: 1 }))
    await writeMeta(fx, makeMeta({ n: 2 }))
    const cache = new MetaCache()
    expect((await cache.read(fx.dataDir)).metas).toHaveLength(2)
    await fs.rm(file)
    expect((await cache.read(fx.dataDir)).metas).toHaveLength(1)
  })
})

describe("データフォルダ・会話ログの所在", () => {
  it("明示指定のフォルダに claude-code-sessions があれば使い、無ければ null", async () => {
    const fx = await fixture()
    expect(await resolveDesktopDataDir(fx.dataDir)).toBe(fx.dataDir)
    expect(await resolveDesktopDataDir(path.join(fx.dataDir, "nothing"))).toBeNull()
  })

  it("フォルダ名を計算せず、全フォルダから cliSessionId.jsonl を探す", async () => {
    const fx = await fixture()
    await writeTranscript(fx, fakeCliId(1), [], "-sample-project-1")
    await writeTranscript(fx, fakeCliId(2), [], "ssh-sample-connection")
    await fs.writeFile(path.join(fx.projectsRoot, "-sample-project-1", "notes.txt"), "x")
    const index = await indexTranscripts(fx.projectsRoot)
    expect(index.get(fakeCliId(1))?.dirName).toBe("-sample-project-1")
    expect(index.get(fakeCliId(2))?.dirName).toBe("ssh-sample-connection")
    expect(index.size).toBe(2)
    expect((await indexTranscripts(path.join(fx.projectsRoot, "missing"))).size).toBe(0)
  })
})
