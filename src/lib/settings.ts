import { backupFile, readJsonFile, resolveProjectPath, writeJsonFile } from "./fileIO"
import { ProjectConfig, SettingsView } from "./types"

export async function getSettings(project: ProjectConfig): Promise<SettingsView> {
  const settingsPath = resolveProjectPath(project.path, "settings.json")
  const raw = await readJsonFile<Record<string, unknown>>(settingsPath, {})
  return { raw }
}

/** settings.jsonを上書き保存する。書き込み前に既存ファイルを`.ccd-backup.<epoch>`として退避する */
export async function updateSettings(
  project: ProjectConfig,
  raw: Record<string, unknown>
): Promise<SettingsView> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("settings.json はJSONオブジェクトである必要があります")
  }
  const settingsPath = resolveProjectPath(project.path, "settings.json")
  await backupFile(settingsPath)
  await writeJsonFile(settingsPath, raw)
  return { raw }
}
