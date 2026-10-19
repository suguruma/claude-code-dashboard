import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto"
import { readJsonFile, writeJsonFile } from "../fileIO"
import { withFileLock } from "./config"

/** 登録した端末の鍵の有効期限(登録から90日) */
export const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000
/** 登録できる端末の数 */
export const MAX_DEVICES = 10
/** 最後に見た日時を書く間隔(これより短い間隔では書かない) */
export const TOUCH_INTERVAL_MS = 60_000
const NAME_MAX = 40

export interface LanDevice {
  id: string
  name: string
  /** 鍵の SHA-256(16進)。鍵そのものは保存しない */
  keyHash: string
  createdAt: number
  lastSeenAt: number | null
  expiresAt: number
}

/** 画面に返す形(鍵のハッシュは出さない) */
export type PublicLanDevice = Omit<LanDevice, "keyHash">

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex")
}

/** 端末の鍵: 32バイトの乱数(base64url) */
export function newDeviceKey(): string {
  return randomBytes(32).toString("base64url")
}

function isDevice(v: unknown): v is LanDevice {
  if (!v || typeof v !== "object") return false
  const d = v as Record<string, unknown>
  return (
    typeof d.id === "string" &&
    typeof d.name === "string" &&
    typeof d.keyHash === "string" &&
    /^[0-9a-f]{64}$/.test(d.keyHash) &&
    typeof d.createdAt === "number" &&
    (d.lastSeenAt === null || typeof d.lastSeenAt === "number") &&
    typeof d.expiresAt === "number"
  )
}

export async function loadDevices(file: string): Promise<LanDevice[]> {
  try {
    const raw = await readJsonFile<unknown>(file, [])
    return Array.isArray(raw) ? raw.filter(isDevice) : []
  } catch {
    return []
  }
}

/** 鍵に合う、期限内の端末。比べるのはハッシュどうしで、長さの決まった比較にする */
export function findDeviceByKey(devices: LanDevice[], key: string, now: number): LanDevice | null {
  if (!key) return null
  const want = Buffer.from(hashSecret(key), "hex")
  for (const d of devices) {
    const have = Buffer.from(d.keyHash, "hex")
    if (have.length === want.length && timingSafeEqual(have, want) && d.expiresAt > now) return d
  }
  return null
}

export type RegisterResult = { ok: true; device: LanDevice; key: string } | { ok: false; reason: "full" }

/** 端末を登録して、鍵を1回だけ返す。期限切れの端末は、このとき一覧から外す */
export async function registerDevice(file: string, name: string, now: number): Promise<RegisterResult> {
  return withFileLock(file, async () => {
    const devices = (await loadDevices(file)).filter((d) => d.expiresAt > now)
    if (devices.length >= MAX_DEVICES) return { ok: false, reason: "full" } as const
    const key = newDeviceKey()
    const device: LanDevice = {
      id: randomUUID(),
      name: cleanName(name) || "端末",
      keyHash: hashSecret(key),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + DEVICE_TTL_MS,
    }
    await writeJsonFile(file, [...devices, device])
    return { ok: true, device, key } as const
  })
}

export async function revokeDevice(file: string, id: string): Promise<boolean> {
  return withFileLock(file, async () => {
    const devices = await loadDevices(file)
    const rest = devices.filter((d) => d.id !== id)
    if (rest.length === devices.length) return false
    await writeJsonFile(file, rest)
    return true
  })
}

export async function renameDevice(file: string, id: string, name: string): Promise<boolean> {
  const cleaned = cleanName(name)
  if (!cleaned) return false
  return withFileLock(file, async () => {
    const devices = await loadDevices(file)
    const target = devices.find((d) => d.id === id)
    if (!target) return false
    target.name = cleaned
    await writeJsonFile(file, devices)
    return true
  })
}

/** 最後に見た日時を、1分に1回まで書く。読み直してから書くので、取り消した端末を書き戻さない */
export async function touchDevice(file: string, id: string, now: number): Promise<void> {
  await withFileLock(file, async () => {
    const devices = await loadDevices(file)
    const target = devices.find((d) => d.id === id)
    if (!target) return
    if (target.lastSeenAt !== null && now - target.lastSeenAt < TOUCH_INTERVAL_MS) return
    target.lastSeenAt = now
    await writeJsonFile(file, devices)
  })
}

export function publicDevice(d: LanDevice): PublicLanDevice {
  return { id: d.id, name: d.name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, expiresAt: d.expiresAt }
}

function cleanName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME_MAX)
}

/** User-Agent から「iPhone・Safari」のような名前を作る(PC の画面で変えられる) */
export function deviceNameFromUserAgent(ua: string | null | undefined): string {
  const s = ua ?? ""
  const os = /iPhone/.test(s)
    ? "iPhone"
    : /iPad/.test(s)
      ? "iPad"
      : /Android/.test(s)
        ? "Android"
        : /Windows/.test(s)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(s)
            ? "Mac"
            : "端末"
  const browser = /EdgA?\//.test(s)
    ? "Edge"
    : /SamsungBrowser\//.test(s)
      ? "Samsung Internet"
      : /CriOS\/|Chrome\//.test(s)
        ? "Chrome"
        : /FxiOS\/|Firefox\//.test(s)
          ? "Firefox"
          : /Safari\//.test(s)
            ? "Safari"
            : ""
  return browser ? `${os}・${browser}` : os
}
