import { execFile } from "child_process"
import path from "path"
import { isAutodetectDisabled, type Env } from "./dataLocations"

/**
 * 起動中のClaude Code CLI(claude.exe)が、どのセッションを開いているかを調べる(段階2)。
 *
 * - 問い合わせは固定のPowerShellスクリプト1つだけ。ユーザーの入力は一切埋め込まない(-EncodedCommandで渡す)。
 * - コマンドライン全体(--settings等の長い引数を含む)はNode側に渡さない。PowerShellの中で
 *   `--resume=<UUID>` の値だけを取り出して出力し、Node側が受け取るのはUUIDの一覧だけ。
 * - プロセスの有無を読むだけで、終了させたり操作したりしない。
 * - 1回に0.1〜1秒かかるため、30秒以上の間隔でバックグラウンド実行し、結果をキャッシュする。
 *   呼び出し側(一覧API)は peek() で手元の結果を即座に受け取り、待たされない。
 * - Windows以外・取得に失敗したときは null を返し、呼び出し側は「この情報なし」として扱う。
 * - 自動の探索を止めているとき(`CCD_DESKTOP_AUTODETECT=0`。合成データで撮る・確かめるとき)は、この PC で動いている
 *   本物の claude.exe を見ないよう、PowerShell を1回も実行せずに null を返す(⑧-3)。
 */

const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"

/** 固定のスクリプト。claude.exe の --resume=<UUID> の UUID だけを1行ずつ出力する */
export const LIST_RESUME_IDS_SCRIPT =
  `Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | ` +
  `ForEach-Object { if ($_.CommandLine -match '--resume=(${UUID_PATTERN})') { $Matches[1] } }`

/** PowerShellの -EncodedCommand 用(UTF-16LEのBase64)。クォートの解釈に依存せず、固定の内容をそのまま渡せる */
export function encodeScript(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64")
}

const UUID_LINE = new RegExp(`^${UUID_PATTERN}$`)

/** スクリプトの出力(UUIDが1行に1つ)から、セッションIDの集合を作る。UUID以外の行は捨てる */
export function parseResumeIds(output: string): Set<string> {
  const ids = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const id = line.trim()
    if (UUID_LINE.test(id)) ids.add(id.toLowerCase())
  }
  return ids
}

function powershellPath(): string {
  const root = process.env.SystemRoot
  return root ? path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe"
}

/** 既定の実行方法: 固定のPowerShellスクリプトを実行し、標準出力(UUIDの一覧)を返す */
export function runPowerShellListing(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      powershellPath(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodeScript(LIST_RESUME_IDS_SCRIPT)],
      { timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => (err ? reject(new Error("プロセスの取得に失敗しました")) : resolve(String(stdout)))
    )
  })
}

export interface CliProcessSource {
  /** 手元の結果を即座に返す。まだ取得できていない・取得に失敗している・Windows以外のときは null */
  peek(): Set<string> | null
}

export interface CliProcessWatcherOptions {
  /** 取得の実行方法(テスト用に差し替え可能)。UUIDが1行に1つの文字列を返す */
  run?: () => Promise<string>
  now?: () => number
  intervalMs?: number
  platform?: NodeJS.Platform
  /** 環境変数(テスト用に差し替え可能)。`CCD_DESKTOP_AUTODETECT=0` なら取得しない */
  env?: Env
}

const DEFAULT_INTERVAL_MS = 30_000
/** 取得が失敗し続けたとき、最後に成功した結果を使い続ける長さ(間隔の倍数)。超えたら「情報なし」に戻す */
const STALE_AFTER_INTERVALS = 3

/**
 * 古くなった結果を、バックグラウンドで読み直すキャッシュ。peek() が呼ばれたときに、結果が古ければ
 * 読み直しを始める(タイマーを常駐させない)。読み直しの完了は待たない。
 */
export class CliProcessWatcher implements CliProcessSource {
  private readonly run: () => Promise<string>
  private readonly now: () => number
  private readonly intervalMs: number
  private readonly supported: boolean
  private readonly env: Env | undefined

  private result: { ids: Set<string>; at: number } | null = null
  private lastAttemptAt = -Infinity
  private inFlight: Promise<void> | null = null

  constructor(options: CliProcessWatcherOptions = {}) {
    this.run = options.run ?? runPowerShellListing
    this.now = options.now ?? Date.now
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.supported = (options.platform ?? process.platform) === "win32"
    this.env = options.env
  }

  peek(): Set<string> | null {
    if (!this.supported || isAutodetectDisabled(this.env ?? process.env)) return null
    if (!this.inFlight && this.now() - this.lastAttemptAt >= this.intervalMs) {
      void this.refresh()
    }
    if (!this.result) return null
    if (this.now() - this.result.at > this.intervalMs * STALE_AFTER_INTERVALS) return null
    return this.result.ids
  }

  /** 読み直す。実行中なら、その完了を待つ(テスト用。peek() は待たない) */
  refresh(): Promise<void> {
    if (isAutodetectDisabled(this.env ?? process.env)) return Promise.resolve()
    if (this.inFlight) return this.inFlight
    this.lastAttemptAt = this.now()
    this.inFlight = this.run()
      .then((output) => {
        this.result = { ids: parseResumeIds(output), at: this.now() }
      })
      .catch(() => {
        // 取得に失敗した。前回の結果は(古くなるまで)そのまま使い、エラーの内容は残さない
      })
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }
}
