import { promises as fs } from "fs"
import path from "path"
import { BACKUP_INFIX, FileIOError, pruneDirBackups, resolveProjectPath } from "./fileIO"
import { parseFrontmatter } from "./frontmatter"
import { UNSET_MODEL_DIR, assertValidModelName, sanitizeModelDirName } from "./skillArchivePaths"
import { ArchivedSkillVersion, ProjectConfig } from "./types"
import { InvalidInputError, NotFoundError } from "./errors"

/**
 * 切り替え前の自動退避のフォルダ名の区切り。`<スキル名>.switch-backup.<epoch ms>` を、モデルのフォルダの中に作る。
 * 同じモデルのアーカイブへ切り替えるとき、切り替え前の今の内容をアーカイブ一覧に残す(画面から戻せる)ために使う。
 */
export const SWITCH_BACKUP_INFIX = ".switch-backup."

/** スキルのフォルダ直下にある、SKILL.md の退避(項目: スキル本体の編集・改名・インポート)。バックアップ画面から戻すもの */
const SKILL_MD_BACKUP_RE = new RegExp(`^SKILL\\.md${BACKUP_INFIX.replace(/\./g, "\\.")}\\d{10,}$`)

/**
 * スキルのフォルダ名がパスの一部として安全か。パス区切りや `.`・`..` を含むもの、空のものは拒否する。
 * （スキルの編集・改名と違い、半角英数字以外の名前は拒否しない。アーカイブは、ダッシュボードの外で作られたスキルにも使えるため）
 */
function assertSafeDirName(dirName: string): void {
  if (!dirName || dirName === "." || dirName === ".." || /[\\/]/.test(dirName)) {
    throw new InvalidInputError("不正なスキル名です")
  }
}

function skillsDir(project: ProjectConfig): string {
  return resolveProjectPath(project.path, "skills")
}

function archiveRoot(project: ProjectConfig): string {
  return resolveProjectPath(project.path, "skills-archive")
}

function activeSkillPath(project: ProjectConfig, dirName: string): string {
  return path.join(skillsDir(project), dirName)
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
 * スキルのフォルダを複製する。フォルダ直下の `SKILL.md.ccd-backup.<epoch>`(SKILL.md の退避)は複製しない。
 * 退避はアクティブなスキルのフォルダに置いたままにして、バックアップ画面から戻せるようにするため
 * (アーカイブへ複製すると、画面から見えなくなる。アーカイブから戻すとき、古い退避が紛れ込むのも避ける)。
 */
async function copySkillDir(srcDir: string, destDir: string): Promise<void> {
  const root = path.resolve(srcDir)
  await fs.cp(srcDir, destDir, {
    recursive: true,
    filter: (source) => !(path.dirname(path.resolve(source)) === root && SKILL_MD_BACKUP_RE.test(path.basename(source))),
  })
}

/** スキルのフォルダの中身を空にする。ただし、`SKILL.md.ccd-backup.<epoch>` は残す(切り替えたあとも、バックアップ画面に出るように) */
async function clearSkillDirKeepingBackups(dir: string): Promise<void> {
  for (const name of await fs.readdir(dir)) {
    if (SKILL_MD_BACKUP_RE.test(name)) continue
    await fs.rm(path.join(dir, name), { recursive: true, force: true })
  }
}

/** `<dir><infix><epoch ms>` のうち、まだ無い名前。同じミリ秒に続けて作っても、別の世代になる(既存のフォルダへ混ざらない) */
async function freeBackupPath(dirPath: string, infix = BACKUP_INFIX): Promise<string> {
  let timestamp = Date.now()
  while (await pathExists(`${dirPath}${infix}${timestamp}`)) timestamp += 1
  return `${dirPath}${infix}${timestamp}`
}

/**
 * 上書き前に同名バックアップ(`<dir>.ccd-backup.<epoch ms>`)を作成する（ディレクトリ版）。
 * 対象が存在しない場合は何もしない。exportImport.tsのbackupFile（ファイル版）と同じ命名規則。
 * 作成後、同じ名前の古い退避フォルダを保持方針(retention.ts)に従って削除する。削除の失敗は無視する(退避の作成は成功している)。
 * この退避は、画面からは戻せない(必要なら、フォルダ名を元に戻す)。
 */
async function backupDirIfExists(dirPath: string): Promise<void> {
  if (!(await pathExists(dirPath))) return
  const backupPath = await freeBackupPath(dirPath)
  await fs.cp(dirPath, backupPath, { recursive: true })
  await fs.rm(dirPath, { recursive: true, force: true })
  await pruneDirBackups(dirPath).catch(() => undefined)
}

/** 指定したモデルのフォルダにある、スキルの「切り替え前の自動退避」(`<スキル名>.switch-backup.<epoch ms>`)の時刻の一覧 */
async function listSwitchBackupTimes(modelDirPath: string, dirName: string): Promise<number[]> {
  const prefix = `${dirName}${SWITCH_BACKUP_INFIX}`
  let dirents
  try {
    dirents = await fs.readdir(modelDirPath, { withFileTypes: true })
  } catch {
    return []
  }
  const times: number[] = []
  for (const d of dirents) {
    if (!d.isDirectory() || !d.name.startsWith(prefix)) continue
    const suffix = d.name.slice(prefix.length)
    if (!/^\d{10,}$/.test(suffix)) continue
    if (!(await pathExists(path.join(modelDirPath, d.name, "SKILL.md")))) continue
    times.push(Number(suffix))
  }
  return times
}

/**
 * 指定スキルについて、アーカイブ済みのバージョン一覧を返す。
 * モデル別のアーカイブ（更新日時の新しい順）のあとに、「切り替え前の自動退避」（`switchBackupAt` つき。退避の新しい順）が続く。
 */
export async function listArchivedVersions(
  project: ProjectConfig,
  dirName: string
): Promise<ArchivedSkillVersion[]> {
  assertSafeDirName(dirName)
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
  const switchBackups: ArchivedSkillVersion[] = []
  for (const modelDir of modelDirs) {
    const model = modelDir === UNSET_MODEL_DIR ? "" : modelDir
    const skillPath = path.join(root, modelDir, dirName)
    if (await pathExists(path.join(skillPath, "SKILL.md"))) {
      versions.push({ model, updatedAt: await readUpdatedAt(skillPath) })
    }
    for (const at of await listSwitchBackupTimes(path.join(root, modelDir), dirName)) {
      const backupPath = `${skillPath}${SWITCH_BACKUP_INFIX}${at}`
      switchBackups.push({ model, updatedAt: await readUpdatedAt(backupPath), switchBackupAt: at })
    }
  }

  versions.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
  switchBackups.sort((a, b) => (b.switchBackupAt ?? 0) - (a.switchBackupAt ?? 0))
  return [...versions, ...switchBackups]
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
  assertSafeDirName(dirName)
  const activePath = activeSkillPath(project, dirName)
  if (!(await pathExists(path.join(activePath, "SKILL.md")))) {
    throw new NotFoundError("スキルが見つかりません")
  }
  const model = (await readTargetModel(activePath)) ?? ""
  const destPath = archivedSkillPath(project, model, dirName)

  await backupDirIfExists(destPath)
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  await copySkillDir(activePath, destPath)

  return { model, updatedAt: await readUpdatedAt(destPath) }
}

/**
 * アーカイブ済みの指定バージョン（モデル別のアーカイブ、または `switchBackupAt` で指す「切り替え前の自動退避」）を、
 * 現在アクティブなスキルと入れ替える。
 * 1. 現在アクティブなバージョンを退避する
 *    - 切り替え先と同じモデルのとき（＝編集前の状態への復元）: そのモデルのフォルダに「切り替え前の自動退避」
 *      (`<スキル名>.switch-backup.<epoch>`)として残す。アーカイブ一覧に出て、画面から戻せる。保持方針(retention.ts)で整理する
 *    - 別のモデルへのとき: 現在の対象モデル配下へ退避（既存があれば`.ccd-backup`化）。アーカイブ一覧に出る
 * 2. アーカイブ側の指定バージョンをアクティブ側へコピー（アーカイブ側は保持したまま。再切替に備える）
 * スキルのフォルダ直下の `SKILL.md.ccd-backup.<epoch>`（SKILL.md の退避）は、アーカイブへ複製せず、切り替えたあともアクティブ側に残す。
 */
export async function restoreArchivedVersion(
  project: ProjectConfig,
  dirName: string,
  model: string,
  switchBackupAt?: number
): Promise<void> {
  assertSafeDirName(dirName)
  assertValidModelName(model)
  if (switchBackupAt !== undefined && !/^\d{10,}$/.test(String(switchBackupAt))) {
    throw new InvalidInputError("不正な退避の指定です")
  }
  const activePath = activeSkillPath(project, dirName)
  const modelArchivePath = archivedSkillPath(project, model, dirName)
  const sourcePath =
    switchBackupAt === undefined ? modelArchivePath : `${modelArchivePath}${SWITCH_BACKUP_INFIX}${switchBackupAt}`
  if (!(await pathExists(path.join(sourcePath, "SKILL.md")))) {
    throw new NotFoundError("指定されたモデルのアーカイブが見つかりません")
  }

  let prune: (() => Promise<unknown>) | null = null
  if (await pathExists(path.join(activePath, "SKILL.md"))) {
    const currentModel = (await readTargetModel(activePath)) ?? ""
    const outgoingDest = archivedSkillPath(project, currentModel, dirName)
    if (sanitizeModelDirName(currentModel) === sanitizeModelDirName(model)) {
      // 切り替え先と同じモデル: モデル別のアーカイブは、切り替え先（または、その元）が使っているので上書きしない。
      // 切り替え前の今の内容を、「切り替え前の自動退避」としてアーカイブ一覧に残す
      const snapshot = await freeBackupPath(outgoingDest, SWITCH_BACKUP_INFIX)
      await fs.mkdir(path.dirname(snapshot), { recursive: true })
      await copySkillDir(activePath, snapshot)
      // 整理は最後に行う（切り替え先が古い自動退避でも、コピーする前に消えないように）
      prune = () => pruneDirBackups(outgoingDest, Date.now(), SWITCH_BACKUP_INFIX)
    } else {
      await backupDirIfExists(outgoingDest)
      await fs.mkdir(path.dirname(outgoingDest), { recursive: true })
      await copySkillDir(activePath, outgoingDest)
    }
    await clearSkillDirKeepingBackups(activePath)
  }

  await fs.mkdir(activePath, { recursive: true })
  await copySkillDir(sourcePath, activePath)
  if (prune) await prune().catch(() => undefined)
}
