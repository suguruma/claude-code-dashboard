import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { readSessionSemanticDiagnosis } from "./sessionSemanticDiagnosis"

const cleanupDirs: string[] = []

async function makeDir(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-semanticdiag-test-"))
  cleanupDirs.push(tmpDir)
  return tmpDir
}

async function writeDiagnosis(dir: string, data: unknown): Promise<void> {
  await fs.writeFile(path.join(dir, "session_diagnosis.json"), JSON.stringify(data, null, 2))
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("readSessionSemanticDiagnosis", () => {
  it("cwdがnullならnullを返す", async () => {
    expect(await readSessionSemanticDiagnosis(null, "s1")).toBeNull()
  })

  it("session_diagnosis.jsonが無ければnullを返す", async () => {
    const dir = await makeDir()
    expect(await readSessionSemanticDiagnosis(dir, "s1")).toBeNull()
  })

  it("sessionIdが一致しない場合はnullを返す（別セッション向けの古い診断）", async () => {
    const dir = await makeDir()
    await writeDiagnosis(dir, {
      version: 1,
      generatedAt: "2026-07-28T00:00:00.000Z",
      sessionId: "other-session",
      summary: "概要",
      overall: "good",
      findings: [],
    })
    expect(await readSessionSemanticDiagnosis(dir, "s1")).toBeNull()
  })

  it("正しい形式なら診断内容をそのまま返す", async () => {
    const dir = await makeDir()
    await writeDiagnosis(dir, {
      version: 1,
      generatedAt: "2026-07-28T00:00:00.000Z",
      sessionId: "s1",
      summary: "Markdownビューアーの開発セッション",
      overall: "warning",
      findings: [
        {
          id: "misunderstanding",
          title: "要求の誤解",
          severity: "warning",
          observation: "初期実装で要件を取り違えていた",
          action: "要件確認を先に行う",
        },
        {
          id: "good-point",
          title: "良かった点",
          severity: "good",
          observation: "テストを先に書いていた",
          action: null,
        },
      ],
    })

    const diagnosis = await readSessionSemanticDiagnosis(dir, "s1")
    expect(diagnosis).toEqual({
      version: 1,
      generatedAt: "2026-07-28T00:00:00.000Z",
      sessionId: "s1",
      summary: "Markdownビューアーの開発セッション",
      overall: "warning",
      findings: [
        {
          id: "misunderstanding",
          title: "要求の誤解",
          severity: "warning",
          observation: "初期実装で要件を取り違えていた",
          action: "要件確認を先に行う",
        },
        {
          id: "good-point",
          title: "良かった点",
          severity: "good",
          observation: "テストを先に書いていた",
          action: null,
        },
      ],
    })
  })

  it("トップレベルの必須フィールドが欠けている場合はnullを返す", async () => {
    const dir = await makeDir()
    await writeDiagnosis(dir, { version: 1, sessionId: "s1", findings: [] })
    expect(await readSessionSemanticDiagnosis(dir, "s1")).toBeNull()
  })

  it("overallが不正な値の場合はnullを返す", async () => {
    const dir = await makeDir()
    await writeDiagnosis(dir, {
      sessionId: "s1",
      summary: "概要",
      overall: "excellent",
      findings: [],
    })
    expect(await readSessionSemanticDiagnosis(dir, "s1")).toBeNull()
  })

  it("個々のfinding要素が壊れている場合はその要素だけをスキップする", async () => {
    const dir = await makeDir()
    await writeDiagnosis(dir, {
      sessionId: "s1",
      summary: "概要",
      overall: "good",
      findings: [
        { id: "valid", title: "有効な項目", severity: "good", observation: "問題なし", action: null },
        { id: "broken", title: "壊れた項目", severity: "not-a-severity", observation: "x", action: null },
        "not-even-an-object",
      ],
    })

    const diagnosis = await readSessionSemanticDiagnosis(dir, "s1")
    expect(diagnosis?.findings).toEqual([
      { id: "valid", title: "有効な項目", severity: "good", observation: "問題なし", action: null },
    ])
  })
})
