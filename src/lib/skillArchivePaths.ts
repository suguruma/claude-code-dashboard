import { InvalidInputError } from "./errors"
/**
 * スキルのアーカイブ(`skills-archive/<モデル>/<スキル名>`)の、フォルダ名の決め方。fs に触れない純粋な関数だけを置く
 * (サーバー側の skillArchive.ts と、画面の文言が同じ決め方を使うため)。
 */

/** 対象モデルが未設定のスキルをしまうフォルダ名 */
export const UNSET_MODEL_DIR = "_未設定"

/**
 * `.` だけでできた名前（`.`・`..`・`...` など。前後の空白は無視）か。
 * フォルダ名に使うと、`.` は今のフォルダ、`..` は1つ上（プロジェクト直下）を指してしまうので、モデル名としては使えない。
 */
export function isDotOnlyName(name: string): boolean {
  return /^\.+$/.test(name.trim())
}

/** モデル名が、アーカイブのフォルダ名として使えない（`.` だけの名前）なら例外にする。モデル名を受け取る入口・書き込む側で使う */
export function assertValidModelName(model: string): void {
  if (isDotOnlyName(model)) throw new InvalidInputError("不正なモデル名です（. だけの名前は使えません）")
}

/**
 * モデル名はディレクトリ名として使うため、パス区切り文字等を安全な文字に置換する。
 * 空は `_未設定`。`.` だけでできた名前（`.`・`..`・`...`）は、先頭に `_` を付けた名前（`_..` など）にする
 * （`..` のままだと skills-archive の外を指すため）。ほかの入口で拒否していても、ここでも必ず塞ぐ。
 */
export function sanitizeModelDirName(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return UNSET_MODEL_DIR
  const replaced = trimmed.replace(/[\\/:*?"<>|]/g, "_")
  return /^\.+$/.test(replaced) ? `_${replaced}` : replaced
}

/** アーカイブの置き場所を、プロジェクトからの相対で表した文字列（画面の文言用）。例: `skills-archive/Opus 5/sample-skill` */
export function archiveLocationLabel(model: string, dirName: string): string {
  return `skills-archive/${sanitizeModelDirName(model)}/${dirName}`
}
