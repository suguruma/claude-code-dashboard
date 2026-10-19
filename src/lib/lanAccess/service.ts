import QRCode from "qrcode"
import { lanFiles, readLanSettings, readLanStatus, writeLanSettings, type LanFiles, type LanStatus } from "./config"
import { loadDevices, publicDevice, renameDevice, revokeDevice, type PublicLanDevice } from "./devices"
import { issuePairingCode, pairingInfo, type PairingInfo } from "./pairing"

/** PC の画面「スマホから見る」に出す、まとめた状態(鍵のハッシュ・コードの平文は含めない) */
export interface LanOverview {
  enabled: boolean
  status: LanStatus
  devices: PublicLanDevice[]
  pairing: PairingInfo
}

export async function getLanOverview(now: number, files: LanFiles = lanFiles()): Promise<LanOverview> {
  const [settings, status, devices, pairing] = await Promise.all([
    readLanSettings(files),
    readLanStatus(files),
    loadDevices(files.devices),
    pairingInfo(files.pairing, now),
  ])
  return {
    enabled: settings.enabled,
    // オフにした直後など、入り口がまだ状態を書き直していないときは、設定のほうを優先して見せる
    status: settings.enabled ? status : { ...status, state: "off", urls: [] },
    devices: devices.sort((a, b) => b.createdAt - a.createdAt).map(publicDevice),
    pairing,
  }
}

export async function setLanEnabled(enabled: boolean, files: LanFiles = lanFiles()): Promise<void> {
  await writeLanSettings({ enabled }, files)
}

export class LanNotListeningError extends Error {}

export interface IssuedPairing {
  /** 登録コード(この応答でだけ返す。ファイルにはハッシュだけを書く) */
  code: string
  expiresAt: number
  /** スマホで開く URL(待ち受けているアドレスごと) */
  urls: string[]
  /** 最初の URL の QR コード(SVG の文字列。外部と通信せずに作る) */
  qrSvg: string
}

/** 登録コードを出す。入り口が待ち受けていなければ出さない(スマホから開けないため) */
export async function issueLanPairing(now: number, files: LanFiles = lanFiles()): Promise<IssuedPairing> {
  const [settings, status] = await Promise.all([readLanSettings(files), readLanStatus(files)])
  if (!settings.enabled || status.state !== "listening" || status.urls.length === 0) throw new LanNotListeningError()
  const { code, expiresAt } = await issuePairingCode(files.pairing, now)
  const urls = status.urls.map((base) => `${base}/pair?code=${code}`)
  const qrSvg = await QRCode.toString(urls[0], { type: "svg", errorCorrectionLevel: "M", margin: 1 })
  return { code, expiresAt, urls, qrSvg }
}

export async function revokeLanDevice(id: string, files: LanFiles = lanFiles()): Promise<boolean> {
  return revokeDevice(files.devices, id)
}

export async function renameLanDevice(id: string, name: string, files: LanFiles = lanFiles()): Promise<boolean> {
  return renameDevice(files.devices, id, name)
}
