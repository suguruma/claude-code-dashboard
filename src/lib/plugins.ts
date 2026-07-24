import path from "path"
import { readJsonFile, resolveProjectPath } from "./fileIO"
import { BlockedPlugin, ProjectConfig } from "./types"

interface BlocklistFile {
  plugins?: BlockedPlugin[]
}

export async function listBlockedPlugins(project: ProjectConfig): Promise<BlockedPlugin[]> {
  const blocklistPath = resolveProjectPath(project.path, path.join("plugins", "blocklist.json"))
  const data = await readJsonFile<BlocklistFile>(blocklistPath, {})
  return Array.isArray(data.plugins) ? data.plugins : []
}
