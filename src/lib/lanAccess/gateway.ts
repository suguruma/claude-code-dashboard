import { promises as fs } from "fs"
import http from "http"
import net, { type Socket } from "net"
import { isPrivateIPv4, localPrivateIPv4s, normalizeIPv4 } from "./addresses"
import { LAN_COOKIE, LAN_HEADER, LAN_PORT, lanFiles, readLanSettings, writeLanStatus, type LanFiles, type LanStatus } from "./config"
import { DEVICE_TTL_MS, deviceNameFromUserAgent, findDeviceByKey, loadDevices, registerDevice, touchDevice, type LanDevice } from "./devices"
import { decideLanRequest, readCookie } from "./gatewayPolicy"
import { lanPage } from "./lanPages"
import { redeemPairingCode } from "./pairing"

/**
 * LAN の入り口(⑪)。オンのときだけ、この PC のプライベートな IPv4 アドレスで待ち受け、判定(gatewayPolicy.ts)を
 * 通った読み取りの要求だけを、127.0.0.1 の Next へ中継する。Next の待ち受けと、ループバックの扱いは変えない。
 * - 接続してきた相手のアドレスが、プライベートな IPv4 でなければ、すぐに切る(Host の守りに重ねる)
 * - オン・オフと PC の IP アドレスの変化は、数秒ごとに見直して、待ち受けを開く・閉じる(再起動は要らない)
 * - ログは、メソッド・パス・状態の番号まで。鍵・登録コード・問い合わせの文字列は出さない
 */

/**
 * 中継の先(Next)へ渡すヘッダー(この一覧にあるものだけ)。画面と部品の読み込み・キャッシュ・画面の切り替え(RSC)に要るものだけで、
 * ブラウザの出どころ(Origin・Referer)・LAN の鍵(Cookie)・接続の制御・本文の長さ・偽の印(x-middleware-subrequest・x-real-ip・
 * X-HTTP-Method-Override・x-forwarded-* など)は渡さない(「落とすもの」の一覧だと、知らないヘッダーが素通りするため)
 */
export const FORWARD_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "accept-encoding",
  "user-agent",
  "cache-control",
  "pragma",
  "if-none-match",
  "if-modified-since",
  "range",
  "if-range",
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "next-url",
  "next-hmr-refresh",
  // 開発のサーバーが、ページの要求と画面の更新の通知(デバッグの情報)を対応づける番号。無いと、開発のサーバーの画面遷移が止まる
  "x-nextjs-request-id",
  "x-nextjs-html-request-id",
])
const DROP_RESPONSE_HEADERS = new Set(["set-cookie", "connection", "keep-alive", "transfer-encoding"])

export interface LanGatewayOptions {
  files?: () => LanFiles
  /** 中継の先(Next)の番号。要求のたびに読む(開発のサーバーは、起動の途中で PORT が決まるため) */
  appPort?: () => number
  lanPort?: number
  addresses?: () => string[]
  now?: () => number
  log?: (line: string) => void
  /** 開発のサーバー(next dev)で動いているか。true のときだけ、登録した端末の画面の更新の通知(WebSocket)を中継する */
  devHmr?: boolean
  /** 接続を受け付ける相手のアドレスか(既定はプライベートな IPv4 だけ。テストで差し替える) */
  allowRemote?: (remoteAddress: string | undefined) => boolean
}

export interface LanGateway {
  /** 設定と PC の IP アドレスを読み直し、待ち受けを合わせる */
  reconcile(): Promise<LanStatus>
  status(): LanStatus
  close(): Promise<void>
}

export function createLanGateway(options: LanGatewayOptions = {}): LanGateway {
  const files = options.files ?? (() => lanFiles())
  const appPort = options.appPort ?? (() => Number(process.env.PORT) || 3000)
  const lanPort = options.lanPort ?? LAN_PORT
  const addresses = options.addresses ?? (() => localPrivateIPv4s())
  const now = options.now ?? (() => Date.now())
  const log = options.log ?? ((line: string) => console.log(line))
  const devHmr = options.devHmr ?? process.env.NODE_ENV === "development"
  const allowRemote = options.allowRemote ?? ((addr: string | undefined) => isPrivateIPv4(normalizeIPv4(addr)))

  const servers = new Map<string, http.Server>()
  const failed = new Map<string, string>()
  let current: LanStatus = { state: "off", urls: [], error: null, updatedAt: now() }
  let deviceCache: { mtimeMs: number; devices: LanDevice[] } | null = null
  let reconciling: Promise<LanStatus> | null = null
  /** 起動して最初の見直しでは、前回の状態のファイルが残っていても上書きする */
  let written = false

  async function devices(): Promise<LanDevice[]> {
    const file = files().devices
    let mtimeMs = -1
    try {
      mtimeMs = (await fs.stat(file)).mtimeMs
    } catch {
      deviceCache = { mtimeMs: -1, devices: [] }
      return []
    }
    if (!deviceCache || deviceCache.mtimeMs !== mtimeMs) deviceCache = { mtimeMs, devices: await loadDevices(file) }
    return deviceCache.devices
  }

  function send(res: http.ServerResponse, status: number, body: string, type: string, extra: http.OutgoingHttpHeaders = {}) {
    res.writeHead(status, {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...extra,
    })
    res.end(body)
  }

  function sendHtml(res: http.ServerResponse, status: number, kind: Parameters<typeof lanPage>[0], extra: http.OutgoingHttpHeaders = {}) {
    send(res, status, lanPage(kind), "text/html; charset=utf-8", extra)
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const method = (req.method ?? "GET").toUpperCase()
    const rawUrl = req.url ?? "/"
    const pathOnly = rawUrl.split("?")[0]
    const done = (status: number) => log(`[lan] ${method} ${pathOnly} ${status}`)
    try {
      const at = now()
      const key = readCookie(req.headers.cookie, LAN_COOKIE)
      const device = key ? findDeviceByKey(await devices(), key, at) : null
      const result = decideLanRequest({
        method,
        host: req.headers.host ?? null,
        rawUrl,
        isUpgrade: Boolean(req.headers.upgrade),
        localAddresses: addresses(),
        port: lanPort,
        deviceValid: device !== null,
        devAssets: devHmr,
      })

      // ふつうの要求の経路では、接続の切り替えは中継しない(devHmr を渡さないので、upgrade にはならない)
      if (result.action === "reject" || result.action === "upgrade") {
        const reason = result.action === "reject" ? result.reason : "接続の切り替えは受け付けません"
        send(res, 403, JSON.stringify({ error: reason }), "application/json; charset=utf-8")
        return done(403)
      }
      if (result.action === "needKey") {
        if (result.api) send(res, 401, JSON.stringify({ error: "この端末は登録されていません" }), "application/json; charset=utf-8")
        else sendHtml(res, 401, "register")
        return done(401)
      }
      if (result.action === "pair") {
        const redeemed = await redeemPairingCode(files().pairing, result.code, at)
        if (redeemed !== "ok") {
          sendHtml(res, 400, redeemed === "locked" ? "locked" : redeemed === "expired" ? "expired" : "invalid")
          return done(400)
        }
        const registered = await registerDevice(files().devices, deviceNameFromUserAgent(req.headers["user-agent"]), at)
        if (!registered.ok) {
          sendHtml(res, 409, "full")
          return done(409)
        }
        const cookie = `${LAN_COOKIE}=${registered.key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(DEVICE_TTL_MS / 1000)}`
        send(res, 302, "", "text/plain; charset=utf-8", { location: "/", "set-cookie": cookie })
        return done(302)
      }

      // 中継する
      if (device) void touchDevice(files().devices, device.id, at).catch(() => undefined)
      const port = appPort()
      const headers: http.OutgoingHttpHeaders = {}
      for (const [name, value] of Object.entries(req.headers)) {
        const lower = name.toLowerCase()
        if (FORWARD_REQUEST_HEADERS.has(lower) && value !== undefined) headers[lower] = value
      }
      headers.host = `127.0.0.1:${port}`
      headers[LAN_HEADER] = "1"
      const upstream = http.request(
        { host: "127.0.0.1", port, method, path: result.pathname + result.search, headers },
        (up) => {
          const out: http.OutgoingHttpHeaders = {}
          for (const [name, value] of Object.entries(up.headers)) {
            if (DROP_RESPONSE_HEADERS.has(name.toLowerCase()) || value === undefined) continue
            out[name] = value
          }
          // Next が絶対の URL(127.0.0.1)へ移すときは、スマホから見える入り口の URL に直す
          const location = typeof out.location === "string" ? out.location : null
          const origin = `http://127.0.0.1:${port}`
          if (location && location.startsWith(origin)) out.location = location.slice(origin.length) || "/"
          const status = up.statusCode ?? 502
          res.writeHead(status, out)
          up.pipe(res)
          done(status)
        }
      )
      upstream.on("error", () => {
        if (!res.headersSent) send(res, 502, JSON.stringify({ error: "ダッシュボードに接続できません" }), "application/json; charset=utf-8")
        else res.end()
        done(502)
      })
      upstream.end()
    } catch {
      if (!res.headersSent) send(res, 500, JSON.stringify({ error: "処理に失敗しました" }), "application/json; charset=utf-8")
      else res.end()
      done(500)
    }
  }

  function onConnection(socket: Socket) {
    // 相手がプライベートな IPv4 でなければ切る(VPN などの意図しない網から来た接続を、Host を見る前に止める)
    if (!allowRemote(socket.remoteAddress)) socket.destroy()
  }

  /**
   * 接続の切り替え(WebSocket)。断るのが基本で、開発のサーバーの画面の更新の通知だけを、登録した端末から中継する
   * (判定は gatewayPolicy.ts。Host・接続元・鍵の守りは、ふつうの要求と同じ)
   */
  async function onUpgrade(req: http.IncomingMessage, socket: Socket, head: Buffer) {
    const method = (req.method ?? "GET").toUpperCase()
    const rawUrl = req.url ?? "/"
    const forbid = () => {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
      log(`[lan] ${method} ${rawUrl.split("?")[0]} 403 (upgrade)`)
    }
    try {
      const key = readCookie(req.headers.cookie, LAN_COOKIE)
      const device = key ? findDeviceByKey(await devices(), key, now()) : null
      const result = decideLanRequest({
        method,
        host: req.headers.host ?? null,
        rawUrl,
        isUpgrade: true,
        localAddresses: addresses(),
        port: lanPort,
        deviceValid: device !== null,
        devHmr,
      })
      if (result.action !== "upgrade") return forbid()
      const port = appPort()
      const lines = [`GET ${result.pathname}${result.search} HTTP/1.1`, `Host: 127.0.0.1:${port}`, `${LAN_HEADER}: 1`]
      for (const [name, value] of Object.entries(req.headers)) {
        const lower = name.toLowerCase()
        const keep = lower === "connection" || lower === "upgrade" || lower.startsWith("sec-websocket-") || lower === "user-agent" || lower === "pragma" || lower === "cache-control"
        if (keep && value !== undefined) lines.push(`${name}: ${Array.isArray(value) ? value.join(", ") : value}`)
      }
      const upstream = net.connect(port, "127.0.0.1", () => {
        upstream.write(lines.join("\r\n") + "\r\n\r\n")
        if (head.length > 0) upstream.write(head)
        socket.pipe(upstream).pipe(socket)
        log(`[lan] ${method} ${result.pathname} 101 (upgrade)`)
      })
      upstream.on("error", () => socket.destroy())
      socket.on("error", () => upstream.destroy())
      socket.on("close", () => upstream.destroy())
    } catch {
      forbid()
    }
  }

  function open(addr: string): Promise<void> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => void handle(req, res))
      server.on("connection", onConnection)
      server.on("upgrade", (req, socket, head) => void onUpgrade(req, socket as Socket, head))
      server.headersTimeout = 10_000
      server.requestTimeout = 30_000
      server.once("error", (err: NodeJS.ErrnoException) => {
        failed.set(addr, err.code === "EADDRINUSE" ? `番号 ${lanPort} が使用中のため、${addr} で待ち受けられません` : `${addr} で待ち受けられません（${err.code ?? "不明"}）`)
        resolve()
      })
      server.listen(lanPort, addr, () => {
        failed.delete(addr)
        servers.set(addr, server)
        resolve()
      })
    })
  }

  function shut(addr: string): Promise<void> {
    const server = servers.get(addr)
    servers.delete(addr)
    if (!server) return Promise.resolve()
    return new Promise((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  async function reconcileOnce(): Promise<LanStatus> {
    const { enabled } = await readLanSettings(files())
    const wanted = enabled ? addresses() : []
    for (const addr of [...servers.keys()]) if (!wanted.includes(addr)) await shut(addr)
    for (const addr of [...failed.keys()]) if (!wanted.includes(addr)) failed.delete(addr)
    for (const addr of wanted) if (!servers.has(addr)) await open(addr)

    // スマホから届きやすい順(addresses の順)のまま。先頭を登録コードの QR に使う
    const urls = wanted.filter((addr) => servers.has(addr)).map((addr) => `http://${addr}:${lanPort}`)
    const errors = [...failed.values()]
    const next: LanStatus = {
      state: !enabled ? "off" : urls.length > 0 ? "listening" : wanted.length === 0 ? "no-address" : "error",
      urls,
      error: errors.length > 0 ? errors.join(" / ") : null,
      updatedAt: now(),
    }
    const changed = next.state !== current.state || next.error !== current.error || next.urls.join() !== current.urls.join()
    if (changed || !written) {
      written = true
      current = next
      await writeLanStatus(current, files()).catch(() => undefined)
      log(`[lan] ${current.state}${current.urls.length ? ` ${current.urls.join(" ")}` : ""}${current.error ? ` (${current.error})` : ""}`)
    }
    return current
  }

  return {
    reconcile() {
      reconciling ??= reconcileOnce().finally(() => {
        reconciling = null
      })
      return reconciling
    },
    status: () => current,
    async close() {
      for (const addr of [...servers.keys()]) await shut(addr)
    },
  }
}

/** オン・オフと IP アドレスの変化を見直す間隔 */
export const LAN_RECONCILE_MS = 2_000

const SINGLETON_KEY = "__ccdLanGateway"

/** Next のサーバーの起動時に1回だけ呼ぶ(instrumentation.ts)。2回呼ばれても、入り口は1つだけ */
export function startLanGateway(): void {
  const g = globalThis as unknown as Record<string, unknown>
  if (g[SINGLETON_KEY]) return
  const gateway = createLanGateway()
  g[SINGLETON_KEY] = gateway
  void gateway.reconcile().catch(() => undefined)
  setInterval(() => void gateway.reconcile().catch(() => undefined), LAN_RECONCILE_MS).unref()
}
