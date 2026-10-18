import { promises as fs } from "fs"
import path from "path"
import { FileIOError, resolveProjectPath } from "./fileIO"
import { parseFrontmatter } from "./frontmatter"
import { selectExpired } from "./retention"
import { ProjectConfig, TrashedSkill } from "./types"
import { ConflictError, InvalidInputError, NotFoundError } from "./errors"

/**
 * スキルの削除は完全削除ではなく、`skills-trash/<名前>-<yyyyMMdd-HHmmss>/` への移動にする。
 * Claude Codeは `skills/` 配下だけをスキルとして読み込むため、退避先は `skills/` の外に置く
 * (`skills-disabled/` や `skills-archive/` と同じ階層)。復元は画面の「削除済みスキル」から行える。
 */
const META_FILE = ".ccd-trash.json"
/** 退避フォルダ名の `<名前>-<yyyyMMdd-HHmmss>`(同じ秒に重なったときだけ末尾に `-<連番>` が付く) */
const FOLDER_NAME_RE = /^(.+)-(\d{8})-(\d{6})(?:-(\d+))?$/

interface TrashMeta {
  dirName: string
  deletedAt: string
  wasEnabled: boolean
}

export function skillTrashDir(project: ProjectConfig): string {
  return resolveProjectPath(project.path, "skills-trash")
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0")
}

/** 退避フォルダ名に使う日時(ローカル時刻)。フォルダを開いたときに、いつ消したか分かるようにする */
function stamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

function stampToDate(date: string, time: string): Date {
  return new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6))
  )
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readMeta(entryDir: string): Promise<TrashMeta | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(entryDir, META_FILE), "utf-8")) as Partial<TrashMeta>
    if (typeof raw.dirName !== "string" || typeof raw.deletedAt !== "string") return null
    return { dirName: raw.dirName, deletedAt: raw.deletedAt, wasEnabled: raw.wasEnabled !== false }
  } catch {
    return null
  }
}

/** スキルを `skills-trash/` へ移す。移したフォルダ名(退避ID)を返す。`skills/` からも `skills-disabled/` からも消える */
export async function moveSkillToTrash(
  project: ProjectConfig,
  dirName: string,
  sourceDir: string,
  wasEnabled: boolean,
  now: Date = new Date()
): Promise<string> {
  const root = skillTrashDir(project)
  await fs.mkdir(root, { recursive: true })

  const base = `${dirName}-${stamp(now)}`
  let id = base
  for (let n = 2; await pathExists(path.join(root, id)); n++) id = `${base}-${n}`
  const dest = path.join(root, id)

  try {
    await fs.rename(sourceDir, dest)
  } catch (err) {
    // 別のドライブにまたがる場合だけ、コピーしてから元を消す(コピーに失敗したら元は消さない)
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err
    await fs.cp(sourceDir, dest, { recursive: true })
    await fs.rm(sourceDir, { recursive: true, force: true })
  }

  const meta: TrashMeta = { dirName, deletedAt: now.toISOString(), wasEnabled }
  // 退避の記録に失敗しても、スキル本体は退避できている(名前から復元できる)ので、削除自体は成功として扱う
  await fs.writeFile(path.join(dest, META_FILE), JSON.stringify(meta, null, 2), "utf-8").catch(() => undefined)

  await pruneSkillTrash(project, now.getTime()).catch(() => undefined)
  return id
}

async function readEntry(root: string, id: string): Promise<TrashedSkill | null> {
  const entryDir = path.join(root, id)
  let stat
  try {
    stat = await fs.stat(entryDir)
  } catch {
    return null
  }
  if (!stat.isDirectory()) return null

  const meta = await readMeta(entryDir)
  const match = FOLDER_NAME_RE.exec(id)
  // 記録ファイルが無い(手で移した等)ときは、フォルダ名と更新日時から推定する
  const dirName = meta?.dirName ?? match?.[1] ?? id
  const deletedAt = meta?.deletedAt ?? (match ? stampToDate(match[2], match[3]) : stat.mtime).toISOString()

  let title: string | undefined
  let description: string | undefined
  try {
    const { data } = parseFrontmatter(await fs.readFile(path.join(entryDir, "SKILL.md"), "utf-8"))
    if (typeof data.title === "string") title = data.title
    if (typeof data.description === "string") description = data.description
  } catch {
    // SKILL.mdが読めなくても、退避の一覧には出す(復元はできる)
  }

  return { id, dirName, deletedAt, wasEnabled: meta?.wasEnabled ?? true, title, description, path: entryDir }
}

/** 削除済みスキルの一覧(削除が新しい順) */
export async function listTrashedSkills(project: ProjectConfig): Promise<TrashedSkill[]> {
  const root = skillTrashDir(project)
  let names: string[]
  try {
    names = await fs.readdir(root)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
    throw new FileIOError(`skills-trash の読み込みに失敗しました: ${String(err)}`)
  }
  const entries = await Promise.all(names.map((name) => readEntry(root, name)))
  return entries
    .filter((e): e is TrashedSkill => e !== null)
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

/** 保持方針(retention.ts)に従い、同じスキル名の古い退避を削除する。削除したフォルダ名を返す */
export async function pruneSkillTrash(project: ProjectConfig, nowMs = Date.now()): Promise<string[]> {
  const root = skillTrashDir(project)
  const entries = await listTrashedSkills(project)
  const byDirName = new Map<string, TrashedSkill[]>()
  for (const e of entries) byDirName.set(e.dirName, [...(byDirName.get(e.dirName) ?? []), e])

  const expired: string[] = []
  for (const group of byDirName.values()) {
    expired.push(
      ...selectExpired(
        group.map((e) => ({ name: e.id, timestampMs: new Date(e.deletedAt).getTime() })),
        nowMs
      )
    )
  }
  await Promise.all(expired.map((id) => fs.rm(path.join(root, id), { recursive: true, force: true })))
  return expired
}

/** 削除済みスキルを元の場所(削除時に有効だったなら `skills/`、無効だったなら `skills-disabled/`)へ戻す */
export async function restoreTrashedSkill(
  project: ProjectConfig,
  id: string
): Promise<{ dirName: string; enabled: boolean }> {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw new InvalidInputError("不正な指定です")
  }
  const entry = (await listTrashedSkills(project)).find((e) => e.id === id)
  if (!entry) throw new NotFoundError("指定された削除済みスキルが見つかりません")
  if (!/^[a-zA-Z0-9_-]+$/.test(entry.dirName)) throw new InvalidInputError("不正な指定です")

  const activeDir = resolveProjectPath(project.path, "skills")
  const disabledDir = resolveProjectPath(project.path, "skills-disabled")
  if ((await pathExists(path.join(activeDir, entry.dirName))) || (await pathExists(path.join(disabledDir, entry.dirName)))) {
    throw new ConflictError(
      `スキル "${entry.dirName}" は既に存在するため復元できません。先に既存のスキルを削除するか、名前を変更してください`
    )
  }

  const destParent = entry.wasEnabled ? activeDir : disabledDir
  await fs.mkdir(destParent, { recursive: true })
  await fs.rename(entry.path, path.join(destParent, entry.dirName))
  await fs.rm(path.join(destParent, entry.dirName, META_FILE), { force: true })
  return { dirName: entry.dirName, enabled: entry.wasEnabled }
}
