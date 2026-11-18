import { readJsonlFrom } from "@/lib/jsonlReader"
import { RouteBuilder, acceptLine, feedLine, type RouteContext } from "./routeRules"

/**
 * ⑲ 1セッションの会話記録を読み、ルートの読み取りの状態にする。書き足された後ろだけを読み足す(相談役 重1)。
 * - 前と同じ並びのファイルで、どのファイルも前に読んだ位置より小さくなっていなければ、続きだけを読む
 * - 並びが変わった・小さくなった(作り直した)・key(地図の版・題名・作業フォルダ)が変わったときは、最初から読む
 * - 拾う行はバイト列で絞る(acceptLine)。入力の文は箱の id と道具の名前に変えた時点で捨てる
 */

export interface RouteFile {
  path: string
  size: number
}

export interface RouteReadState {
  key: string
  files: { path: string; offset: number }[]
  builder: RouteBuilder
  bytes: number
}

export async function readRoute(prev: RouteReadState | null, key: string, files: RouteFile[], ctx: RouteContext): Promise<RouteReadState> {
  const reusable =
    prev !== null &&
    prev.key === key &&
    prev.files.length === files.length &&
    prev.files.every((f, i) => f.path === files[i].path && files[i].size >= f.offset)
  const state: RouteReadState = reusable
    ? prev
    : { key, files: files.map((f) => ({ path: f.path, offset: 0 })), builder: new RouteBuilder(ctx), bytes: 0 }
  for (let i = 0; i < files.length; i++) {
    const target = state.files[i]
    const size = files[i].size
    if (size <= target.offset) continue
    const start = target.offset
    target.offset = await readJsonlFrom(target.path, start, size, (line) => feedLine(state.builder, line), undefined, undefined, acceptLine)
    state.bytes += target.offset - start
  }
  return state
}
