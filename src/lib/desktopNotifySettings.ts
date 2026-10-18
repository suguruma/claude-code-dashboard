import path from "path"
import { readJsonFile, writeJsonFile, getAppDataRoot } from "./fileIO"

/**
 * 要対応のデスクトップ通知のオン・オフ。サーバー側のファイルに保存する。
 * 配布exeは優先ポートで起動するが、そのポートが使用中のときは空きポートに切り替わる。ブラウザのlocalStorageは
 * 保存先(オリジン)がポートごとに分かれ、切り替わった起動では見えなくなるため、ここだけはlocalStorageに頼らない。
 * 初期値はオフ。
 */
export interface DesktopNotifySettings {
  notifications: boolean
}

const DEFAULT_SETTINGS: DesktopNotifySettings = { notifications: false }

function settingsPath(): string {
  return path.join(getAppDataRoot(), "config", "desktop-notify.json")
}

export async function getDesktopNotifySettings(): Promise<DesktopNotifySettings> {
  try {
    const raw = await readJsonFile<Partial<DesktopNotifySettings>>(settingsPath(), DEFAULT_SETTINGS)
    return { notifications: raw?.notifications === true }
  } catch {
    // 壊れている・読めないときは、通知を出さない側(オフ)に倒す
    return { ...DEFAULT_SETTINGS }
  }
}

export class InvalidNotifySettingsError extends Error {}

/** 検証済みの値だけを保存する。保存するのは真偽値1つだけで、ほかの値は受け付けない */
export async function setDesktopNotifySettings(input: unknown): Promise<DesktopNotifySettings> {
  const notifications = (input as { notifications?: unknown } | null)?.notifications
  if (typeof notifications !== "boolean") {
    throw new InvalidNotifySettingsError("notifications は true または false で指定してください")
  }
  const next: DesktopNotifySettings = { notifications }
  await writeJsonFile(settingsPath(), next)
  return next
}
