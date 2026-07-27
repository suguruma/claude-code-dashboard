const { app, BrowserWindow, dialog } = require("electron")
const { spawn } = require("child_process")
const path = require("path")
const fs = require("fs")
const net = require("net")
const http = require("http")

const isDev = !app.isPackaged

let serverProcess = null
let mainWindow = null

function getResourcesRoot() {
  return isDev ? path.join(__dirname, "..") : process.resourcesPath
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * config/projects.json（監視対象プロジェクトの登録・選択状態）は、Node標準ライブラリでの
 * 相対パス解決規則上 process.cwd() 基準になる。配布版exeは実行場所が不定なため、
 * OSごとの安定したユーザーデータ領域（app.getPath("userData")）を実行時cwdとして使い、
 * 初回起動時のみ、個人パスを含まないテンプレート(projects.example.json)とサンプルデータを
 * そこへ複製する。以後の書き込みはこのユーザーデータ領域に永続化される。
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

  const sampleDataDir = path.join(userDataDir, "sample-data")
  if (!fs.existsSync(sampleDataDir)) {
    const seedSampleDataDir = isDev
      ? path.join(resourcesRoot, "sample-data")
      : path.join(resourcesRoot, "seed", "sample-data")
    fs.cpSync(seedSampleDataDir, sampleDataDir, { recursive: true })
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

/**
 * Next.jsのstandaloneサーバー(server.js)を、別途Node.jsランタイムを同梱せず
 * Electron自身のバイナリをELECTRON_RUN_AS_NODE=1で子プロセス起動することで実行する
 * （Electronの公式にサポートされたNode実行モード）。
 */
async function startServer() {
  const resourcesRoot = getResourcesRoot()
  const userDataDir = app.getPath("userData")
  seedUserData(userDataDir, resourcesRoot)

  const port = await getFreePort()
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
    stdio: "inherit",
  })

  await waitForServer(port)
  return port
}

async function createWindow() {
  try {
    const port = await startServer()
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      title: "Claude Code Dashboard",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    mainWindow.on("closed", () => {
      mainWindow = null
    })
    await mainWindow.loadURL(`http://127.0.0.1:${port}`)
  } catch (err) {
    dialog.showErrorBox(
      "起動エラー",
      `サーバーの起動に失敗しました。\n${err instanceof Error ? err.message : String(err)}`
    )
    app.quit()
  }
}

app.whenReady().then(createWindow)

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
})
