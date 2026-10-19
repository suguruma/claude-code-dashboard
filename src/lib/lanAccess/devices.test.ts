import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import {
  DEVICE_TTL_MS,
  MAX_DEVICES,
  TOUCH_INTERVAL_MS,
  deviceNameFromUserAgent,
  findDeviceByKey,
  loadDevices,
  publicDevice,
  registerDevice,
  renameDevice,
  revokeDevice,
  touchDevice,
} from "./devices"

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function devicesFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-lan-devices-test-"))
  cleanup.push(dir)
  return path.join(dir, "config", "lan-devices.json")
}

const T0 = 1_800_000_000_000

async function register(file: string, now = T0) {
  const r = await registerDevice(file, "iPhone・Safari", now)
  if (!r.ok) throw new Error("登録できない")
  return r
}

describe("登録した端末と鍵", () => {
  it("鍵はハッシュでだけ保存し、ファイルに平文が無い。鍵は32バイトの乱数", async () => {
    const file = await devicesFile()
    const { key } = await register(file)
    expect(Buffer.from(key, "base64url")).toHaveLength(32)
    const raw = await fs.readFile(file, "utf-8")
    expect(raw).not.toContain(key)
    expect((await loadDevices(file))[0].keyHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("鍵で端末を見つける。違う鍵・期限切れは見つからない（期限は登録から90日）", async () => {
    const file = await devicesFile()
    const { key, device } = await register(file)
    const list = await loadDevices(file)
    expect(findDeviceByKey(list, key, T0 + 1)?.id).toBe(device.id)
    expect(findDeviceByKey(list, key + "x", T0 + 1)).toBeNull()
    expect(findDeviceByKey(list, "", T0 + 1)).toBeNull()
    expect(device.expiresAt).toBe(T0 + DEVICE_TTL_MS)
    expect(findDeviceByKey(list, key, T0 + DEVICE_TTL_MS)).toBeNull()
  })

  it("取り消した端末の鍵は、見つからない", async () => {
    const file = await devicesFile()
    const { key, device } = await register(file)
    expect(await revokeDevice(file, device.id)).toBe(true)
    expect(findDeviceByKey(await loadDevices(file), key, T0 + 1)).toBeNull()
    expect(await revokeDevice(file, device.id)).toBe(false)
  })

  it("10台まで。期限切れの端末は、登録のときに一覧から外れる", async () => {
    const file = await devicesFile()
    for (let i = 0; i < MAX_DEVICES; i++) await register(file)
    expect(await registerDevice(file, "11台目", T0)).toEqual({ ok: false, reason: "full" })
    // 90日たつと、前の10台は期限切れになり、新しく登録できる
    const later = await registerDevice(file, "新しい端末", T0 + DEVICE_TTL_MS + 1)
    expect(later.ok).toBe(true)
    expect(await loadDevices(file)).toHaveLength(1)
  })

  it("最後に見た日時は1分に1回まで書く。取り消した端末は書き戻さない", async () => {
    const file = await devicesFile()
    const { device } = await register(file)
    await touchDevice(file, device.id, T0 + TOUCH_INTERVAL_MS - 1)
    expect((await loadDevices(file))[0].lastSeenAt).toBe(T0)
    await touchDevice(file, device.id, T0 + TOUCH_INTERVAL_MS)
    expect((await loadDevices(file))[0].lastSeenAt).toBe(T0 + TOUCH_INTERVAL_MS)
    // 取り消しと最後に見た日時の更新が重なっても、取り消しが消えない
    await Promise.all([revokeDevice(file, device.id), touchDevice(file, device.id, T0 + 10 * TOUCH_INTERVAL_MS)])
    expect(await loadDevices(file)).toHaveLength(0)
  })

  it("名前を変えられる（空は不可・40文字まで）。画面に返す形に鍵のハッシュは無い", async () => {
    const file = await devicesFile()
    const { device } = await register(file)
    expect(await renameDevice(file, device.id, "  台所のスマホ  ")).toBe(true)
    expect(await renameDevice(file, device.id, "   ")).toBe(false)
    const [saved] = await loadDevices(file)
    expect(saved.name).toBe("台所のスマホ")
    expect(publicDevice(saved)).not.toHaveProperty("keyHash")
  })

  it("User-Agent から名前を作る", () => {
    expect(deviceNameFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone・Safari")
    expect(deviceNameFromUserAgent("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe("Android・Chrome")
    expect(deviceNameFromUserAgent(null)).toBe("端末")
  })
})
