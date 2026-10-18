const { app, BrowserWindow, Notification, dialog, ipcMain, shell } = require("electron")
const { spawn } = require("child_process")
const path = require("path")
const fs = require("fs")
const http = require("http")
const { PREFERRED_PORT, pickPort } = require("./port")
const { isAllowedExternalUrl } = require("./externalUrl")
const { appOriginOf, isTrustedIpcEvent, navigationDecision } = require("./origin")
const { createNoticeSlot, portFallbackNotice } = require("./startupNotice")

const isDev = !app.isPackaged

// Windowsのトースト通知を出すために必要なアプリ識別子(electron-builder.yml の appId と同じ値)
if (process.platform === "win32") app.setAppUserModelId("com.claudecodedashboard.app")

let serverProcess = null
let mainWindow = null
let splashWindow = null
/** この起動で決まったアプリのオリジン(http://127.0.0.1:<ポート>)。ポートが決まるまでは null で、そのあいだは何も許可しない */
let appOrigin = null
/** 優先ポートが使えなかったときの、画面上部の帯の情報。画面が最初に読み取ったときに渡して消す */
const startupNotice = createNoticeSlot()

/**
 * 起動所要時間の記録が無い初回起動時に使う既定の見積り。portable exeは起動のたびに
 * 自己展開（実測約25秒）が発生するため、その分を見込んだ値にしている。
 */
const DEFAULT_STARTUP_ESTIMATE_MS = 30000

/**
 * スプラッシュの進捗マイルストーン。実イベントに到達するたびにジャンプし、
 * その間は経過時間ベースで次のマイルストーン手前まで滑らかに近づける。
 */
const PROGRESS_MILESTONES = [
  { stage: "seed", percent: 5, label: "初期データを確認中" },
  { stage: "spawn", percent: 15, label: "サーバーを起動中" },
  { stage: "next-ready", percent: 60, label: "サーバーの準備が完了" },
  { stage: "http-ok", percent: 90, label: "接続を確認中" },
  { stage: "page-loaded", percent: 100, label: "起動完了" },
]

function getResourcesRoot() {
  return isDev ? path.join(__dirname, "..") : process.resourcesPath
}

/**
 * config/projects.json（監視対象プロジェクトの登録・選択状態）は、Node標準ライブラリでの
 * 相対パス解決規則上 process.cwd() 基準になる。配布版exeは実行場所が不定なため、
 * OSごとの安定したユーザーデータ領域（app.getPath("userData")）を実行時cwdとして使い、
 * 初回起動時のみ、個人パスを含まないテンプレート(projects.example.json)をそこへ複製する。
 * 以後の書き込みはこのユーザーデータ領域に永続化される。
 * サンプルデータはexe本体には同梱せず、GitHub Releaseに添付したzipを別途ダウンロード・
 * 展開してユーザー自身が「プロジェクトを追加」から登録する運用とする（exeを必要最低限に保つため）。
 */
function seedUserData(userDataDir, resourcesRoot) {
  const configDir = path.join(userDataDir, "config")
  const projectsJson = path.join(configDir, "projects.json")
  if (!fs.existsSync(projectsJson)) {
    fs.mkdirSync(configDir, { recursive: true })
    const seedProjectsJson = isDev
      ? path.join(resourcesRoot, "config", "projects.example.json")
      : path.join(resourcesRoot, "seed", "config", "projects.example.json")
    fs.copyFileSync(seedProjectsJson, projectsJson)
  }
}

function waitForServer(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (res) => {
        res.resume()
        resolve()
      })
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("サーバー起動待機がタイムアウトしました"))
        else setTimeout(attempt, 300)
      })
      req.on("timeout", () => req.destroy())
    }
    attempt()
  })
}

function getStartupStatsPath(userDataDir) {
  return path.join(userDataDir, "startup-stats.json")
}

/** 前回の起動所要時間（ms）。記録が無い初回起動時はDEFAULT_STARTUP_ESTIMATE_MSを使う */
function readLastStartupDurationMs(userDataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(getStartupStatsPath(userDataDir), "utf-8"))
    if (typeof data.lastDurationMs === "number" && data.lastDurationMs > 0) return data.lastDurationMs
  } catch {
    // ファイルが無い（初回起動）・壊れている場合は既定値にフォールバック
  }
  return DEFAULT_STARTUP_ESTIMATE_MS
}

function saveStartupDurationMs(userDataDir, durationMs) {
  try {
    fs.writeFileSync(getStartupStatsPath(userDataDir), JSON.stringify({ lastDurationMs: durationMs }))
  } catch {
    // 次回の残り時間目安の精度が落ちるだけで起動自体には影響しないため、失敗しても無視する
  }
}

/**
 * スプラッシュ画面。frame無しの小さいウィンドウで、進捗％と残り時間の目安を表示する。
 * 【表示できる範囲の制約】配布しているportable exeは、起動のたびにOSレベルで自己展開してから
 * このElectronプロセス（本ファイル）が動き出す。自己展開フェーズは実測で起動時間の大半（約25秒）を
 * 占めるが、そこはまだ本アプリのコードが一切実行されていないため、このスプラッシュでは検知も
 * 表示もできない。ここで可視化できるのは、自己展開後の「サーバー起動〜画面描画」の区間のみ。
 */
function createSplashWindow() {
  const win = new BrowserWindow({
    width: 360,
    height: 180,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "splashPreload.js"),
    },
  })
  win.once("ready-to-show", () => win.show())
  win.loadFile(path.join(__dirname, "splash.html"))
  return win
}

/** マイルストーン到達でジャンプし、その間は経過時間ベースで次のマイルストーン手前まで補間する */
function createProgressReporter(win, expectedTotalMs) {
  const startedAt = Date.now()
  let current = 0
  let ceiling = PROGRESS_MILESTONES[0].percent - 1

  function send(percent, label) {
    if (!win || win.isDestroyed()) return
    const elapsedMs = Date.now() - startedAt
    const etaSeconds = Math.max(Math.round((expectedTotalMs - elapsedMs) / 1000), 0)
    win.webContents.send("splash:progress", {
      percent: Math.max(0, Math.min(percent, 100)),
      label: label ?? null,
      etaSeconds,
    })
  }

  const timer = setInterval(() => {
    current += (ceiling - current) * 0.06
    send(current)
  }, 150)

  return {
    reach(stage) {
      const idx = PROGRESS_MILESTONES.findIndex((m) => m.stage === stage)
      if (idx === -1) return
      current = PROGRESS_MILESTONES[idx].percent
      ceiling = idx + 1 < PROGRESS_MILESTONES.length ? PROGRESS_MILESTONES[idx + 1].percent - 1 : 100
      send(current, PROGRESS_MILESTONES[idx].label)
    },
    stop() {
      clearInterval(timer)
    },
  }
}

/**
 * Next.jsのstandaloneサーバー(server.js)を、別途Node.jsランタイムを同梱せず
 * Electron自身のバイナリをELECTRON_RUN_AS_NODE=1で子プロセス起動することで実行する
 * （Electronの公式にサポートされたNode実行モード）。
 */
async function startServer(progress) {
  const resourcesRoot = getResourcesRoot()
  const userDataDir = app.getPath("userData")
  seedUserData(userDataDir, resourcesRoot)
  progress?.reach("seed")

  const { port, isPreferred } = await pickPort()
  appOrigin = appOriginOf(port)
  startupNotice.set(portFallbackNotice({ port, isPreferred, preferredPort: PREFERRED_PORT }))
  if (!isPreferred) {
    console.warn(
      `[port] 優先ポートが使えないため、空いているポート ${port} で起動します。` +
        "この起動の間だけ、ブラウザに保存した画面の設定(localStorage)は別扱いになります"
    )
  }
  const standaloneDir = isDev
    ? path.join(resourcesRoot, ".next", "standalone")
    : path.join(resourcesRoot, "standalone")
  const serverJs = path.join(standaloneDir, "server.js")

  serverProcess = spawn(process.execPath, [serverJs], {
    cwd: userDataDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      // Next.jsのstandalone server.jsは起動時に無条件でprocess.chdir(__dirname)するため、
      // spawnのcwd指定だけではアプリ自身のデータ配置場所を制御できない。
      // fileIO.ts の getAppDataRoot() がこの環境変数を最優先で参照する。
      CCD_DATA_DIR: userDataDir,
    },
    // stdioは進捗表示のためNext.jsの起動ログを拾う必要があり"pipe"にしている。
    // ターミナルでの可視性（isDev時のデバッグ用途）はprocess.stdout/stderrへの手動転送で維持する。
    stdio: ["ignore", "pipe", "pipe"],
  })

  let nextReadyDetected = false
  serverProcess.stdout.on("data", (chunk) => {
    const text = chunk.toString()
    process.stdout.write(text)
    if (!nextReadyDetected && /ready/i.test(text)) {
      nextReadyDetected = true
      progress?.reach("next-ready")
    }
  })
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(chunk.toString()))

  await waitForServer(port)
  progress?.reach("http-ok")
  return port
}

/**
 * IPCの送り元の確認。すべてのハンドラーで最初に通す。
 * 本アプリのメインウィンドウのメインフレームで、そのページのオリジン(event.senderFrame の URL)がアプリのものであるときだけ受け付ける。
 * （外部のページが開いてしまった場合や、子フレームから呼ばれた場合に、ファイルの読み取り・通知・外部アプリの起動を許さない）
 */
function isTrustedSender(event) {
  return Boolean(mainWindow) && isTrustedIpcEvent(event, mainWindow.webContents, appOrigin)
}

/**
 * インポート機能の「ファイルを選択」で、<input type="file">のクリックが
 * ネイティブダイアログを開かない環境が報告された（項目6）ため、
 * dialog.showOpenDialogを直接呼び出す経路を用意する。
 */
ipcMain.handle("dialog:pick-import-file", async (event) => {
  if (!isTrustedSender(event)) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "インポートするJSONファイルを選択",
    filters: [{ name: "JSON", extensions: ["json"] }],
    properties: ["openFile"],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  try {
    return { fileName: path.basename(filePath), content: fs.readFileSync(filePath, "utf-8") }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
})

/**
 * 要対応のデスクトップ通知(段階2)。外部のサービスは使わず、OSの通知(Electron Notification)を表示する。
 * 表示するのは、レンダラーから渡されたセッション名と要対応の内容の抜粋だけ。
 * クリックされたらウィンドウを前面に出し、対象のセッションIDをレンダラーへ渡して詳細を開かせる。
 */
const NOTIFICATION_SESSION_ID = /^[A-Za-z0-9_-]{1,100}$/
/** Notificationはガベージコレクションされるとクリックイベントが届かなくなるため、閉じるまで参照を保持する */
const liveNotifications = new Set()

ipcMain.handle("desktop-notify:supported", (event) => {
  if (!isTrustedSender(event)) return false
  return Notification.isSupported()
})

ipcMain.handle("desktop-notify:show", (event, payload) => {
  // 本アプリのウィンドウ以外からの要求は受け付けない
  if (!isTrustedSender(event)) return { ok: false }
  if (!Notification.isSupported()) return { ok: false }
  const title = typeof payload?.title === "string" ? payload.title.slice(0, 120) : ""
  const body = typeof payload?.body === "string" ? payload.body.slice(0, 240) : ""
  const sessionId =
    typeof payload?.sessionId === "string" && NOTIFICATION_SESSION_ID.test(payload.sessionId) ? payload.sessionId : null
  if (!title) return { ok: false }

  const notification = new Notification({ title, body, silent: false })
  liveNotifications.add(notification)
  const release = () => liveNotifications.delete(notification)
  notification.on("close", release)
  notification.on("failed", release)
  notification.on("click", () => {
    release()
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send("desktop-notify:open", sessionId)
  })
  notification.show()
  return { ok: true }
})

/**
 * 「セッションを開く」: Claude Desktopのセッションを、claude:// のリンクで開く。
 * 本アプリのウィンドウからの要求で、かつ許可したURLの形式(electron/externalUrl.js)に完全に一致するときだけ開く。
 */
ipcMain.handle("shell:open-external", async (event, url) => {
  if (!isTrustedSender(event)) return { ok: false }
  return { ok: await openAllowedExternal(url) }
})

/**
 * 起動の通知（優先ポートが使えず別のポートで起動したときの帯）を、画面に1回だけ渡す。渡したあとは空になるので、
 * 画面を再読み込みしても、同じ起動の間に2回は出ない。通知が無ければ null。
 */
ipcMain.handle("startup:notice", (event) => {
  if (!isTrustedSender(event)) return null
  return startupNotice.take()
})

/** 許可リスト（electron/externalUrl.js）にあるURLだけを、既定のアプリ・ブラウザで開く。開けたかを返す */
async function openAllowedExternal(url) {
  if (!isAllowedExternalUrl(url)) return false
  try {
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}

/** 同じURLを短い間に続けて開かない（1回の移動で、複数のイベントが同じURLを知らせても、1回だけ開く） */
const OPEN_DEDUPE_MS = 1000
let lastOpened = { url: "", at: 0 }
function openAllowedExternalOnce(url) {
  const now = Date.now()
  if (lastOpened.url === url && now - lastOpened.at < OPEN_DEDUPE_MS) return
  lastOpened = { url, at: now }
  void openAllowedExternal(url)
}

/**
 * ウィンドウが、アプリのオリジン(http://127.0.0.1:<ポート>)の外へ移動すること・新しい窓を開くことを止める。
 * すべての webContents（メイン・スプラッシュ）に付ける。アプリ内のリンクが外部のページを開いてしまうと、そのページに
 * preload の electronAPI が渡るため、移動そのものを止めておく。
 * 許可リスト（electron/externalUrl.js）にある外部URL（claude:// のセッションのリンクなど）だけは、窓では開かず、
 * 既定のアプリ・ブラウザで開く。それ以外は何も開かない。
 */
function guardNavigation(contents) {
  const blockUnlessApp = (details) => {
    const decision = navigationDecision(details.url, appOrigin)
    if (decision === "allow") return
    details.preventDefault()
    if (decision === "external") openAllowedExternalOnce(details.url)
  }
  contents.on("will-navigate", blockUnlessApp)
  contents.on("will-frame-navigate", blockUnlessApp)
  contents.on("will-redirect", (details) => {
    if (navigationDecision(details.url, appOrigin) !== "allow") details.preventDefault()
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (navigationDecision(url, appOrigin) === "external") openAllowedExternalOnce(url)
    return { action: "deny" }
  })
}

app.on("web-contents-created", (_event, contents) => guardNavigation(contents))

async function createWindow() {
  const startedAt = Date.now()
  const userDataDir = app.getPath("userData")
  const expectedTotalMs = readLastStartupDurationMs(userDataDir)

  splashWindow = createSplashWindow()
  const progress = createProgressReporter(splashWindow, expectedTotalMs)

  try {
    const port = await startServer(progress)
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      title: "Claude Code Dashboard",
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js"),
      },
    })
    mainWindow.on("closed", () => {
      mainWindow = null
    })
    mainWindow.once("ready-to-show", () => {
      progress.reach("page-loaded")
      progress.stop()
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
      splashWindow = null
      mainWindow.show()
      saveStartupDurationMs(userDataDir, Date.now() - startedAt)
    })
    await mainWindow.loadURL(`http://127.0.0.1:${port}`)
  } catch (err) {
    progress.stop()
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
    splashWindow = null
    dialog.showErrorBox(
      "起動エラー",
      `サーバーの起動に失敗しました。\n${err instanceof Error ? err.message : String(err)}`
    )
    app.quit()
  }
}

/**
 * 開いている窓を前に出す。2つ目の起動を見つけたときに使う。メインウィンドウがまだ表示される前（起動中）は、スプラッシュを前に出す。
 */
function bringExistingWindowToFront() {
  const mainReady = mainWindow && !mainWindow.isDestroyed() && (mainWindow.isVisible() || mainWindow.isMinimized())
  const target = mainReady ? mainWindow : splashWindow && !splashWindow.isDestroyed() ? splashWindow : null
  if (!target) return
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
}

// 二重起動の防止。同じデータフォルダ（userData）で2つ目を起動すると、サーバーも窓も作らずに終了し、
// 開いている窓を前に出す。2つのサーバーが同じ設定ファイルを同時に書き換えるのと、優先ポートが埋まって
// 画面の設定（localStorage）が別扱いになるのを避ける。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", bringExistingWindowToFront)
  app.whenReady().then(createWindow)
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
})
