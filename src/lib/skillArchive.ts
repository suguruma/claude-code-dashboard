import { promises as fs } from "fs"
import path from "path"
import { FileIOError, resolveProjectPath } from "./fileIO"
import { parseFrontmatter } from "./frontmatter"
import { ArchivedSkillVersion, ProjectConfig } from "./types"

const UNSET_MODEL_DIR = "_未設定"

function skillsDir(project: ProjectConfig): string {
  return resolveProjectPath(project.path, "skills")
}

function archiveRoot(project: ProjectConfig): string {
  return resolveProjectPath(project.path, "skills-archive")
}

function activeSkillPath(project: ProjectConfig, dirName: string): string {
  return path.join(skillsDir(project), dirName)
}

/** モデル名はディレクトリ名として使うため、パス区切り文字等を安全な文字に置換する */
function sanitizeModelDirName(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return UNSET_MODEL_DIR
  return trimmed.replace(/[\\/:*?"<>|]/g, "_")
}

function archivedSkillPath(project: ProjectConfig, model: string, dirName: string): string {
  return path.join(archiveRoot(project), sanitizeModelDirName(model), dirName)
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readTargetModel(skillDir: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf-8")
    const { data } = parseFrontmatter(content)
    return typeof data["target-model"] === "string" ? data["target-model"] : undefined
  } catch {
    return undefined
  }
}

async function readUpdatedAt(skillDir: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf-8")
    const { data } = parseFrontmatter(content)
    if (typeof data.updated === "string") return data.updated
  } catch {
    return undefined
  }
  return undefined
}

/**
 * 上書き前に同名バックアップ(`<dir>.ccd-backup.<epoch ms>`)を作成する（ディレクトリ版）。
 * 対象が存在しない場合は何もしない。exportImport.tsのbackupFile（ファイル版）と同じ命名規則。
 */
async function backupDirIfExists(dirPath: string): Promise<void> {
  if (!(await pathExists(dirPath))) return
  const backupPath = `${dirPath}.ccd-backup.${Date.now()}`
  await fs.cp(dirPath, backupPath, { recursive: true })
  await fs.rm(dirPath, { recursive: true, force: true })
}

/** 指定スキルについて、アーカイブ済みのモデル別バージョン一覧を返す（更新日時の新しい順） */
export async function listArchivedVersions(
  project: ProjectConfig,
  dirName: string
): Promise<ArchivedSkillVersion[]> {
  const root = archiveRoot(project)
  let modelDirs: string[]
  try {
    const dirents = await fs.readdir(root, { withFileTypes: true })
    modelDirs = dirents.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return []
    throw new FileIOError(`skills-archive の読み込みに失敗しました: ${String(err)}`)
  }

  const versions: ArchivedSkillVersion[] = []
  for (const modelDir of modelDirs) {
    const skillPath = path.join(root, modelDir, dirName)
    if (!(await pathExists(path.join(skillPath, "SKILL.md")))) continue
    const model = modelDir === UNSET_MODEL_DIR ? "" : modelDir
    versions.push({ model, updatedAt: await readUpdatedAt(skillPath) })
  }

  versions.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
  return versions
}

/**
 * 現在アクティブなスキルのバージョンを、現在の対象モデル配下にコピーしてアーカイブする
 * （アクティブ版はそのまま残す。編集前のチェックポイント用途）。
 * 同じモデルの既存アーカイブがあれば、上書き前に`.ccd-backup.<epoch>`として退避する。
 */
export async function archiveCurrentVersion(
  project: ProjectConfig,
  dirName: string
): Promise<ArchivedSkillVersion> {
  const activePath = activeSkillPath(project, dirName)
  if (!(await pathExists(path.join(activePath, "SKILL.md")))) {
    throw new Error("スキルが見つかりません")
  }
  const model = (await readTargetModel(activePath)) ?? ""
  const destPath = archivedSkillPath(project, model, dirName)

  await backupDirIfExists(destPath)
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  await fs.cp(activePath, destPath, { recursive: true })

  return { model, updatedAt: await readUpdatedAt(destPath) }
}

/**
 * アーカイブ済みの指定モデルバージョンを、現在アクティブなスキルと入れ替える。
 * 1. 現在アクティブなバージョンを、その時点の対象モデル配下へ退避（既存があれば`.ccd-backup`化）
 * 2. アーカイブ側の指定バージョンをアクティブ側へコピー（アーカイブ側は保持したまま。再切替に備える）
 * 切替元と切替先が同一モデルの場合（＝編集前の状態への復元）も同じ手順で安全に動作する。
 */
export async function restoreArchivedVersion(
  project: ProjectConfig,
  dirName: string,
  model: string
): Promise<void> {
  const activePath = activeSkillPath(project, dirName)
  const sourcePath = archivedSkillPath(project, model, dirName)
  if (!(await pathExists(path.join(sourcePath, "SKILL.md")))) {
    throw new Error("指定されたモデルのアーカイブが見つかりません")
  }

  if (await pathExists(path.join(activePath, "SKILL.md"))) {
    const currentModel = (await readTargetModel(activePath)) ?? ""
    const outgoingDest = archivedSkillPath(project, currentModel, dirName)
    if (path.resolve(outgoingDest) === path.resolve(sourcePath)) {
      // 復元元と退避先が同一パス（同一モデルへの復元）の場合は、退避先を一時的にずらす
      const tmpDest = `${outgoingDest}.ccd-backup.${Date.now()}`
      await fs.cp(activePath, tmpDest, { recursive: true })
      await fs.rm(activePath, { recursive: true, force: true })
    } else {
      await backupDirIfExists(outgoingDest)
      await fs.mkdir(path.dirname(outgoingDest), { recursive: true })
      await fs.cp(activePath, outgoingDest, { recursive: true })
      await fs.rm(activePath, { recursive: true, force: true })
    }
  }

  await fs.mkdir(path.dirname(activePath), { recursive: true })
  await fs.cp(sourcePath, activePath, { recursive: true })
}
