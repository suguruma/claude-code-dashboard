/**
 * 撮影・確認の前に、サーバーが合成データだけを読んでいるかを確かめる(⑧-2)。人の手順だけに頼らず、機械で止めるための確認。
 *
 * 使い方:
 *   node scripts/check-sample-server.mjs <サーバーのURL> <合成データの出力先のフォルダ>
 *   例: node scripts/check-sample-server.mjs http://127.0.0.1:3961 C:/sample/data/sample
 *
 * セッション一覧の API(`/api/desktop-sessions`)を1回だけ呼び、次の2つを満たすときだけ終了コード0で終わる。
 *   - データの場所の出どころが、設定ファイルか環境変数での明示(explicit-config・explicit-env)であること
 *     (自動で見つけた場所 = この PC の本物のデータかもしれない場所 を読んでいないこと)
 *   - セッションの数が、合成データの期待値(出力先の expected.json の sessionCount)と同じであること
 * 満たさなければ、理由を出して終了コード1で終わる。撮影のスクリプトは、これが0で終わったときだけ撮る。
 * 呼ぶのは、この PC の中のサーバー(127.0.0.1・localhost・[::1])だけ。それ以外のURLは呼ばずに止まる。
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])

/** API の応答と期待値を比べ、問題の一覧を返す(空なら合格) */
export function checkSampleResponse(response, expected) {
  const problems = []
  const origin = response?.dataLocation?.origin
  if (origin !== "explicit-config" && origin !== "explicit-env") {
    problems.push(`データの場所の出どころが明示ではありません（${origin ?? "不明"}）。CCD_DESKTOP_AUTODETECT=0 と、config/desktop-sessions.json の dataDir を確かめてください`)
  }
  const count = Array.isArray(response?.sessions) ? response.sessions.length : null
  if (typeof expected?.sessionCount !== "number") {
    problems.push("expected.json に sessionCount がありません。合成データを作り直してください")
  } else if (count !== expected.sessionCount) {
    problems.push(`セッションの数が合成データと違います（${count ?? "不明"}件。期待は${expected.sessionCount}件）`)
  }
  return problems
}

async function main() {
  const [base, sampleDir] = process.argv.slice(2)
  if (!base || !sampleDir) {
    console.error("使い方: node scripts/check-sample-server.mjs <サーバーのURL> <合成データの出力先のフォルダ>")
    process.exit(1)
  }
  let url
  try {
    url = new URL("/api/desktop-sessions", base)
  } catch {
    console.error(`URL を読めません: ${base}`)
    process.exit(1)
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    console.error(`この PC の中のサーバーだけを確かめます（${url.hostname} は呼びません）`)
    process.exit(1)
  }
  let expected
  try {
    expected = JSON.parse(await readFile(path.join(path.resolve(sampleDir), "expected.json"), "utf-8"))
  } catch (err) {
    console.error(`expected.json を読めません: ${String(err)}`)
    process.exit(1)
  }
  let response
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    response = await res.json()
  } catch (err) {
    console.error(`セッション一覧の API を呼べません: ${String(err)}`)
    process.exit(1)
  }
  const problems = checkSampleResponse(response, expected)
  if (problems.length > 0) {
    for (const p of problems) console.error(`撮らずに止めます: ${p}`)
    process.exit(1)
  }
  console.log(`合成データだけを読んでいます（出どころ ${response.dataLocation.origin}・${response.sessions.length}件）`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main()
}
