import { readJsonFile, resolveProjectPath } from "./fileIO"
import { ProjectConfig, SettingsView } from "./types"

export async function getSettings(project: ProjectConfig): Promise<SettingsView> {
  const settingsPath = resolveProjectPath(project.path, "settings.json")
  const raw = await readJsonFile<Record<string, unknown>>(settingsPath, {})
  return { raw }
}
