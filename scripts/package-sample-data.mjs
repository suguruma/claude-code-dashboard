// sample-data/ を GitHub Release 添付用のzipにまとめる。
// 配布exeにはサンプルデータを同梱しないため（本体を必要最低限に保つ方針）、
// 別ファイルとしてユーザーがダウンロード・展開し、「プロジェクトを追加」から登録する運用にする。
import { execFileSync } from "node:child_process"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf-8"))

const root = path.join(__dirname, "..")
const srcDir = path.join(root, "sample-data")
const outDir = path.join(root, "dist-assets")
const stageDir = path.join(outDir, "sample-data")
const outFile = path.join(outDir, `sample-data-v${pkg.version}.zip`)

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

fs.cpSync(srcDir, stageDir, {
  recursive: true,
  filter: (source) => !path.basename(source).includes(".ccd-backup."),
})

execFileSync(
  "powershell",
  ["-NoProfile", "-Command", `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${outFile}' -Force`],
  { stdio: "inherit" }
)

fs.rmSync(stageDir, { recursive: true, force: true })

console.log(`sample-data.zip を作成しました: ${path.relative(root, outFile)}`)
