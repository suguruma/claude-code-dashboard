/**
 * `next build` の後に、画面の静的ファイル（.next/static）と public/ を、standalone のサーバーの下へ写す。
 * Next.js の standalone 出力（.next/standalone/server.js）は、これらを含まないため、写さないと画面が
 * 「読み込み中...」のまま（/_next/static/... が404）になる。
 *
 * 開発用の起動（npm run electron:dev）と配布 exe の作成（npm run dist:win）で、同じこのスクリプトを使う。
 * 配布 exe は、写したあとの .next/standalone/.next をまとめて同梱する（electron-builder.yml）。
 *
 * 使い方: node scripts/prepare-standalone.mjs
 */
import { cp, rm, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** root（リポジトリのフォルダ）の .next/static と public/ を、.next/standalone の下へ写す。写したものの一覧を返す */
export async function prepareStandalone(root) {
  const standalone = path.join(root, ".next", "standalone")
  if (!(await exists(path.join(standalone, "server.js")))) {
    throw new Error(".next/standalone/server.js がありません。先に next build を実行してください")
  }
  const copies = [
    [path.join(root, ".next", "static"), path.join(standalone, ".next", "static")],
    [path.join(root, "public"), path.join(standalone, "public")],
  ]
  const done = []
  for (const [from, to] of copies) {
    if (!(await exists(from))) continue // public/ は無いことがある
    // 前回のビルドの古いファイルが残らないよう、写す前に消す
    await rm(to, { recursive: true, force: true })
    await cp(from, to, { recursive: true })
    done.push(path.relative(root, to))
  }
  return done
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const done = await prepareStandalone(root)
  console.log(`standalone の下へ写しました: ${done.join("、") || "（写すものなし）"}`)
}
