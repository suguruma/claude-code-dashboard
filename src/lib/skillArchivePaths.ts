import { InvalidInputError } from "./errors"
/**
 * スキルの対象モデル(target-model)の名前の確かめ。fs に触れない純粋な関数だけを置く。
 * (モデル別のアーカイブ〈skills-archive〉は ⑬ の棚卸しの行32 でやめた。対象モデルの名前の確かめは、作成・更新・取り込みで使う)
 */

/**
 * `.` だけでできた名前（`.`・`..`・`...` など。前後の空白は無視）か。
 * フォルダ名に使うと、`.` は今のフォルダ、`..` は1つ上（プロジェクト直下）を指してしまうので、モデル名としては使えない。
 */
export function isDotOnlyName(name: string): boolean {
  return /^\.+$/.test(name.trim())
}

/** モデル名が `.` だけの名前なら例外にする(フォルダ名に使われたときに、今のフォルダ・1つ上を指さないように)。モデル名を受け取る入口・書き込む側で使う */
export function assertValidModelName(model: string): void {
  if (isDotOnlyName(model)) throw new InvalidInputError("不正なモデル名です（. だけの名前は使えません）")
}
