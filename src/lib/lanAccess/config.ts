import path from "path"
import { getAppDataRoot, readJsonFile, writeJsonFile } from "../fileIO"

/**
 * スマホから読み取り専用で見る(⑪)の設定と、ファイルの置き場所。
 * PC の画面の API(Next のルート)と LAN の入り口(gateway.ts)は、状態をこれらのファイルで受け渡す。
 * 鍵・登録コードは、ハッシュでだけ保存する(平文はファイルにもログにも書かない)。
 */

/** LAN の入り口の番号(開発と exe で共通) */
export const LAN_PORT = 38418
/** 端末の鍵を入れるクッキーの名前 */
export const LAN_COOKIE = "ccd_lan_key"
/** LAN の入り口が、中継した要求に付ける印(定義は、fs に触れない gatewayPolicy.ts にある。proxy からも使うため) */
export { LAN_HEADER } from "./gatewayPolicy"

export interface LanSettings {
  enabled: boolean
}

export type LanState = "off" | "listening" | "no-address" | "error"

/** LAN の入り口の待ち受けの状態(入り口が書き、PC の画面が読む) */
export interface LanStatus {
  state: LanState
  /** 待ち受けている URL(`http://<IP>:38418`) */
  urls: string[]
  /** 待ち受けられなかった理由(番号が使用中など)。鍵・コードは含めない */
  error: string | null
  updatedAt: number
}

export interface LanFiles {
  settings: string
  devices: string
  pairing: string
  status: string
}

export function lanFiles(root: string = getAppDataRoot()): LanFiles {
  const dir = path.join(root, "config")
  return {
    settings: path.join(dir, "lan-access.json"),
    devices: path.join(dir, "lan-devices.json"),
    pairing: path.join(dir, "lan-pairing.json"),
    status: path.join(dir, "lan-status.json"),
  }
}

/** 既定はオフ。ファイルが無い・壊れている・形が違うときもオフ */
export async function readLanSettings(files: LanFiles = lanFiles()): Promise<LanSettings> {
  try {
    const raw = await readJsonFile<Partial<LanSettings>>(files.settings, { enabled: false })
    return { enabled: raw?.enabled === true }
  } catch {
    return { enabled: false }
  }
}

export async function writeLanSettings(settings: LanSettings, files: LanFiles = lanFiles()): Promise<void> {
  await writeJsonFile(files.settings, { enabled: settings.enabled === true })
}

export const LAN_STATUS_OFF: LanStatus = { state: "off", urls: [], error: null, updatedAt: 0 }

export async function readLanStatus(files: LanFiles = lanFiles()): Promise<LanStatus> {
  try {
    const raw = await readJsonFile<Partial<LanStatus> | null>(files.status, null)
    if (!raw || typeof raw !== "object") return { ...LAN_STATUS_OFF }
    const state: LanState = raw.state === "listening" || raw.state === "no-address" || raw.state === "error" ? raw.state : "off"
    return {
      state,
      urls: Array.isArray(raw.urls) ? raw.urls.filter((u): u is string => typeof u === "string") : [],
      error: typeof raw.error === "string" ? raw.error : null,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    }
  } catch {
    return { ...LAN_STATUS_OFF }
  }
}

export async function writeLanStatus(status: LanStatus, files: LanFiles = lanFiles()): Promise<void> {
  await writeJsonFile(files.status, status)
}

/**
 * 同じファイルの「読んで・変えて・書く」を、プロセスの中で1つずつにする。
 * PC の画面の API(取り消し・名前の変更)と、入り口(最後に見た日時の更新)が同じファイルを書くため、
 * 重なると取り消しが上書きで消えることがある。両方とも同じ Node のプロセスで動くので、globalThis の列で順番にする
 */
const LOCKS_KEY = "__ccdLanFileLocks"
export async function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as Record<string, Map<string, Promise<unknown>> | undefined>
  const locks = (g[LOCKS_KEY] ??= new Map())
  const prev = locks.get(file) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.then(
    () => undefined,
    () => undefined
  )
  locks.set(file, tail)
  try {
    return await run
  } finally {
    if (locks.get(file) === tail) locks.delete(file)
  }
}
