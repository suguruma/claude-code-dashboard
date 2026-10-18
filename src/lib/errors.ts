/**
 * アプリの中で起きるエラーの種類。API の状態コードは、エラーの文言ではなく、この種類で決める
 * （文言を直しても状態コードが変わらないようにするため）。
 *
 * - InvalidInputError: 入力の誤り（400）
 * - NotFoundError: 指定されたものが無い（404）
 * - ConflictError: 今の状態と衝突している。すでに存在する・すでにその状態・画面の内容が古い（409）
 * - FileIOError: ファイルの読み書きに失敗した（500。文言はそのまま画面に出す）
 *
 * ここにない Error（想定外のエラー）は 500 になる。
 * 入力の誤り・見つからない・衝突を `new Error(...)` のまま投げると 500 になるので、必ず種類のあるエラーを使うこと。
 */

/** 入力の誤り（400） */
export class InvalidInputError extends Error {}

/** 指定されたものが見つからない（404） */
export class NotFoundError extends Error {}

/** 今の状態と衝突している（409）。すでに存在する・すでにその状態になっている・画面の内容が古い、など */
export class ConflictError extends Error {}

/** ファイルの読み書きの失敗（500）。メッセージには対象のファイル名が入る */
export class FileIOError extends Error {}

/** エラーの種類から決まる HTTP の状態コード。種類のない（想定外の）エラーは 500 */
export function statusOfError(err: unknown): number {
  if (err instanceof InvalidInputError) return 400
  if (err instanceof NotFoundError) return 404
  if (err instanceof ConflictError) return 409
  if (err instanceof FileIOError) return 500
  return 500
}

/** 画面に返すエラーの文言。Error なら message、そうでなければ既定の文言 */
export function messageOfError(err: unknown, fallbackMessage = "予期しないエラーが発生しました"): string {
  return err instanceof Error ? err.message : fallbackMessage
}
