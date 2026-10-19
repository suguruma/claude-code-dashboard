import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_TTL_MS,
  LAN_FAILURE_LIMIT,
  MAX_CODE_FAILURES,
  issuePairingCode,
  newPairingCode,
  normalizeCode,
  pairingInfo,
  redeemPairingCode,
} from "./pairing"

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function pairingFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-lan-pairing-test-"))
  cleanup.push(dir)
  return path.join(dir, "config", "lan-pairing.json")
}

const T0 = 1_800_000_000_000

describe("登録コード", () => {
  it("8文字で、読み違えやすい文字（0・O・1・I・L）を含まない", () => {
    for (let i = 0; i < 50; i++) {
      const code = newPairingCode()
      expect(code).toHaveLength(CODE_LENGTH)
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch)
      expect(code).not.toMatch(/[0O1IL]/)
    }
    expect(normalizeCode(" abcd-2345 ")).toBe("ABCD2345")
  })

  it("ファイルには、コードの平文を書かない（ハッシュだけ）", async () => {
    const file = await pairingFile()
    const { code } = await issuePairingCode(file, T0)
    const raw = await fs.readFile(file, "utf-8")
    expect(raw).not.toContain(code)
    expect(raw).toMatch(/"codeHash": "[0-9a-f]{64}"/)
  })

  it("5分以内は使える。5分を過ぎたら断る", async () => {
    const file = await pairingFile()
    const a = await issuePairingCode(file, T0)
    expect(await redeemPairingCode(file, a.code, T0 + CODE_TTL_MS - 1)).toBe("ok")
    const b = await issuePairingCode(file, T0)
    expect(await redeemPairingCode(file, b.code, T0 + CODE_TTL_MS)).toBe("expired")
    expect(await redeemPairingCode(file, b.code, T0 + 1)).toBe("invalid")
  })

  it("1回限り：一度使ったコードは、2回目に断る", async () => {
    const file = await pairingFile()
    const { code } = await issuePairingCode(file, T0)
    expect(await redeemPairingCode(file, code, T0 + 1000)).toBe("ok")
    expect(await redeemPairingCode(file, code, T0 + 2000)).toBe("invalid")
    expect((await pairingInfo(file, T0 + 2000)).active).toBe(false)
  })

  it("新しいコードを出すと、前のコードは断る", async () => {
    const file = await pairingFile()
    const first = await issuePairingCode(file, T0)
    const second = await issuePairingCode(file, T0 + 1000)
    expect(await redeemPairingCode(file, first.code, T0 + 2000)).toBe("invalid")
    expect(await redeemPairingCode(file, second.code, T0 + 3000)).toBe("ok")
  })

  it("1つのコードに5回まちがえたら、正しいコードでも断る", async () => {
    const file = await pairingFile()
    const { code } = await issuePairingCode(file, T0)
    for (let i = 0; i < MAX_CODE_FAILURES; i++) expect(await redeemPairingCode(file, "WRONG234", T0 + i)).toBe("invalid")
    expect(await redeemPairingCode(file, code, T0 + 100)).toBe("invalid")
  })

  it("LAN 全体で10分に20回まちがえたら、PC で新しいコードを出すまで止める", async () => {
    const file = await pairingFile()
    await issuePairingCode(file, T0)
    let last = ""
    for (let i = 0; i < LAN_FAILURE_LIMIT; i++) last = await redeemPairingCode(file, "WRONG234", T0 + i * 1000)
    expect(last).toBe("locked")
    expect((await pairingInfo(file, T0 + 30_000)).locked).toBe(true)
    // 止めているあいだは、正しいコードの形でも断る
    expect(await redeemPairingCode(file, "ABCD2345", T0 + 40_000)).toBe("locked")
    // 新しいコードを出すと、また使える
    const fresh = await issuePairingCode(file, T0 + 50_000)
    expect(await redeemPairingCode(file, fresh.code, T0 + 51_000)).toBe("ok")
  })

  it("コードを出していないときの使用は断る", async () => {
    const file = await pairingFile()
    expect(await redeemPairingCode(file, "ABCD2345", T0)).toBe("invalid")
    expect(await redeemPairingCode(file, null, T0)).toBe("invalid")
  })
})
