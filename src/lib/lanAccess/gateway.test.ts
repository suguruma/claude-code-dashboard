import { promises as fs } from "fs"
import http from "http"
import net from "net"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { LAN_COOKIE, LAN_HEADER, lanFiles, writeLanSettings, type LanFiles } from "./config"
import { loadDevices, revokeDevice } from "./devices"
import { createLanGateway, type LanGateway } from "./gateway"
import { issuePairingCode } from "./pairing"

/**
 * 本物の http のサーバーで、LAN の入り口を確かめる。中継の先には、受け取った要求を記録するだけの小さなサーバーを立てる。
 * 入り口は 127.0.0.1 で待ち受け、「この PC のアドレス」も 127.0.0.1 として渡す(テストのため、接続元の制限も差し替える)。
 */

interface Seen {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo
      s.close(() => resolve(port))
    })
  })
}

async function upstream(): Promise<{ port: number; seen: Seen[] }> {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers })
    if (req.url === "/desktop-sessions/housekeeping") {
      res.writeHead(307, { location: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/desktop-sessions` })
      return res.end()
    }
    res.writeHead(200, { "content-type": "application/json", "set-cookie": "upstream=1" })
    res.end(JSON.stringify({ ok: true, url: req.url }))
  })
  // 接続の切り替えは、届いたことを記録して 101 を返すだけ
  server.on("upgrade", (req, socket) => {
    seen.push({ method: "UPGRADE", url: req.url ?? "", headers: req.headers })
    socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  cleanups.push(() => new Promise((r) => server.close(() => r())))
  return { port: (server.address() as net.AddressInfo).port, seen }
}

async function setup(opts: { allowLoopback?: boolean; devHmr?: boolean } = {}): Promise<{ gateway: LanGateway; files: LanFiles; lanPort: number; seen: Seen[] }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-lan-gateway-test-"))
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }))
  const files = lanFiles(root)
  const up = await upstream()
  const lanPort = await freePort()
  const gateway = createLanGateway({
    files: () => files,
    appPort: () => up.port,
    lanPort,
    addresses: () => ["127.0.0.1"],
    log: () => undefined,
    allowRemote: opts.allowLoopback === false ? undefined : () => true,
    devHmr: opts.devHmr ?? false,
  })
  cleanups.push(() => gateway.close())
  return { gateway, files, lanPort, seen: up.seen }
}

interface Res {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

function request(port: number, o: { method?: string; path?: string; host?: string; cookie?: string; headers?: http.OutgoingHttpHeaders }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: o.method ?? "GET",
        path: o.path ?? "/",
        headers: { host: o.host ?? `127.0.0.1:${port}`, ...(o.cookie ? { cookie: o.cookie } : {}), ...o.headers },
      },
      (res) => {
        let body = ""
        res.on("data", (c) => (body += c))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
      }
    )
    req.on("error", reject)
    req.end()
  })
}

/** 登録コードを出して /pair を開き、発行された鍵のクッキーを返す */
async function pair(files: LanFiles, port: number): Promise<{ cookie: string; res: Res }> {
  const { code } = await issuePairingCode(files.pairing, Date.now())
  const res = await request(port, { path: `/pair?code=${code}`, headers: { "user-agent": "Mozilla/5.0 (iPhone) Safari/604.1" } })
  const setCookie = String(res.headers["set-cookie"] ?? "")
  return { cookie: setCookie.split(";")[0], res }
}

describe("LAN の入り口（本物の http）", () => {
  it("既定はオフで、待ち受けない。オンにすると待ち受け、オフにすると閉じる（再起動なし）", async () => {
    const { gateway, files, lanPort } = await setup()
    expect((await gateway.reconcile()).state).toBe("off")
    await expect(request(lanPort, {})).rejects.toThrow()
    await writeLanSettings({ enabled: true }, files)
    const on = await gateway.reconcile()
    expect(on).toMatchObject({ state: "listening", urls: [`http://127.0.0.1:${lanPort}`] })
    expect((await request(lanPort, {})).status).toBe(401)
    await writeLanSettings({ enabled: false }, files)
    expect((await gateway.reconcile()).state).toBe("off")
    await expect(request(lanPort, {})).rejects.toThrow()
  })

  it("番号が使われていて待ち受けられないときは、落ちずに状態に理由を出す", async () => {
    const { gateway, files, lanPort } = await setup()
    const blocker = net.createServer()
    await new Promise<void>((r) => blocker.listen(lanPort, "127.0.0.1", () => r()))
    cleanups.push(() => new Promise((r) => blocker.close(() => r())))
    await writeLanSettings({ enabled: true }, files)
    const status = await gateway.reconcile()
    expect(status.state).toBe("error")
    expect(status.error).toContain(`${lanPort}`)
    expect(status.error).toContain("使用中")
  })

  it("登録：/pair で鍵が発行され、HttpOnly・SameSite=Strict・Path=/ のクッキーに入る。鍵はファイルに平文で残らない", async () => {
    const { gateway, files, lanPort } = await setup()
    await writeLanSettings({ enabled: true }, files)
    await gateway.reconcile()
    const { cookie, res } = await pair(files, lanPort)
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe("/")
    const setCookie = String(res.headers["set-cookie"])
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=Strict")
    expect(setCookie).toContain("Path=/")
    const key = cookie.slice(`${LAN_COOKIE}=`.length)
    expect(key.length).toBeGreaterThan(40)
    expect(await fs.readFile(files.devices, "utf-8")).not.toContain(key)
    expect((await loadDevices(files.devices))[0].name).toBe("iPhone・Safari")
  })

  it("鍵ありの GET は中継する。Host は 127.0.0.1 に書き換わり、Cookie・Origin・Referer は外れ、x-ccd-via-lan が付く", async () => {
    const { gateway, files, lanPort, seen } = await setup()
    await writeLanSettings({ enabled: true }, files)
    await gateway.reconcile()
    const { cookie } = await pair(files, lanPort)
    const res = await request(lanPort, {
      path: "/api/desktop-sessions/flow?group=g1",
      cookie: `${cookie}; other=1`,
      headers: { origin: "http://evil.example", referer: "http://evil.example/", "sec-fetch-site": "cross-site", [LAN_HEADER]: "forged", "x-forwarded-for": "1.2.3.4" },
    })
    expect(res.status).toBe(200)
    expect(res.headers["set-cookie"]).toBeUndefined()
    const last = seen[seen.length - 1]
    expect(last.url).toBe("/api/desktop-sessions/flow?group=g1")
    expect(last.headers.host).toMatch(/^127\.0\.0\.1:\d+$/)
    expect(last.headers.cookie).toBeUndefined()
    expect(last.headers.origin).toBeUndefined()
    expect(last.headers.referer).toBeUndefined()
    expect(last.headers["sec-fetch-site"]).toBeUndefined()
    expect(last.headers["x-forwarded-for"]).toBeUndefined()
    expect(last.headers[LAN_HEADER]).toBe("1")
  })

  it("中継するヘッダーは「渡すもの」の一覧だけ（RSC と画面の切り替えのヘッダーは渡し、偽の印・本文の長さは渡さない）", async () => {
    const { gateway, files, lanPort, seen } = await setup()
    await writeLanSettings({ enabled: true }, files)
    await gateway.reconcile()
    const { cookie } = await pair(files, lanPort)
    const res = await new Promise<number>((resolve, reject) => {
      const r = http.request(
        {
          host: "127.0.0.1",
          port: lanPort,
          method: "GET",
          path: "/desktop-sessions?_rsc=abc",
          headers: {
            host: `127.0.0.1:${lanPort}`,
            cookie,
            accept: "text/x-component",
            rsc: "1",
            "next-router-state-tree": "%5B%22%22%5D",
            "next-router-prefetch": "1",
            "next-url": "/desktop-sessions",
            "if-none-match": '"abc"',
            "x-nextjs-request-id": "req-1",
            "x-nextjs-html-request-id": "html-1",
            "x-middleware-subrequest": "middleware:middleware:middleware",
            "x-real-ip": "10.0.0.9",
            "x-http-method-override": "DELETE",
            "x-forwarded-host": "evil.example",
            "content-length": "2",
          },
        },
        (resp) => {
          resp.resume()
          resp.on("end", () => resolve(resp.statusCode ?? 0))
        }
      )
      r.on("error", reject)
      r.end("{}")
    })
    expect(res).toBe(200)
    const h = seen[seen.length - 1].headers
    expect(h.rsc).toBe("1")
    expect(h["next-router-state-tree"]).toBe("%5B%22%22%5D")
    expect(h["next-router-prefetch"]).toBe("1")
    expect(h["next-url"]).toBe("/desktop-sessions")
    expect(h.accept).toBe("text/x-component")
    expect(h["if-none-match"]).toBe('"abc"')
    // 開発のサーバーの画面遷移に要る、対応づけの番号
    expect(h["x-nextjs-request-id"]).toBe("req-1")
    expect(h["x-nextjs-html-request-id"]).toBe("html-1")
    for (const name of ["x-middleware-subrequest", "x-real-ip", "x-http-method-override", "x-forwarded-host", "content-length", "cookie"]) {
      expect(h[name], name).toBeUndefined()
    }
  })

  it("開発のサーバーの部品の名前（%5B・%40）は、元の書き方のまま中継する", async () => {
    const { gateway, files, lanPort, seen } = await setup()
    await writeLanSettings({ enabled: true }, files)
    await gateway.reconcile()
    const { cookie } = await pair(files, lanPort)
    const p = "/_next/static/chunks/%5Broot-of-the-server%5D__0ofa7dm._.css"
    expect((await request(lanPort, { path: p, cookie })).status).toBe(200)
    expect(seen[seen.length - 1].url).toBe(p)
    expect((await request(lanPort, { path: "/_next/static/chunks/a%2Fb.js", cookie })).status).toBe(403)
  })

  it("書き込みは、鍵があっても 403 で、中継の先に届かない", async () => {
    const { gateway, files, lanPort, seen } = await setup()
    await writeLanSettings({ enabled: true }, files)
    await gateway.reconcile()
    const { cookie } = await pair(files, lanPort)
    const before = seen.length
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const p of ["/api/desktop-sessions/settings", "/api/rules"]) {
        expect((await request(lanPort, { method, path: p, cookie })).status, `${method} ${p}`).toBe(403)
      }
    }
    expect(seen.length).toBe(before)
  })

  it("鍵なしは 401（ページは案内の HTML、API は JSON）。許可リストの外と、他の Host は 403", async () => {
    const { gateway, files, lanPort, seen } = await setup()
    await writeLanSettings({ enabled: true }, files)
    await gateway.reconcile()
    const page = await request(lanPort, { path: "/" })
    expect(page.status).toBe(401)
    expect(page.headers["content-type"]).toContain("text/html")
    expect(page.body).toContain("スマホの IP アドレスを PC に入れる必要はありません")
    const api = await request(lanPort, { path: "/api/desktop-sessions" })
    expect(api.status).toBe(401)
    expect(api.headers["content-type"]).toContain("application/json")
    const { cookie } = await pair(files, lanPort)
    expect((await request(lanPort, { path: "/rules", cookie })).status).toBe(403)
    expect((await request(lanPort, { path: "/api/lan-access", cookie })).status).toBe(403)
    expect((await request(lanPort, { host: `evil.example:${lanPort}`, cookie })).status).toBe(403)
    expect((await request(lanPort, { host: `localhost:${lanPort}`, cookie })).status).toBe(403)
    expect(seen.length).toBe(0)
  })

  it("取り消した鍵は、次の要求から 401", async () => {
    const { gateway, files, lanPort } = await setup()
    await writeLanSettings({ enabled: true }, files)
    await gateway.reconcile()
    const { cookie } = await pair(files, lanPort)
    expect((await request(lanPort, { path: "/api/usage", cookie })).status).toBe(200)
    const [device] = await loadDevices(files.devices)
    await revokeDevice(files.devices, device.id)
    expect((await request(lanPort, { path: "/api/usage", cookie })).status).toBe(401)
  })

  it("登録コードの2回目の使用・まちがいは 400 の案内で、鍵は発行しない", async () => {
    const { gateway, files, lanPort } = await setup()
    await writeLanSettings({ enabled: true }, files)
    await gateway.reconcile()
    const { code } = await issuePairingCode(files.pairing, Date.now())
    expect((await request(lanPort, { path: `/pair?code=${code}` })).status).toBe(302)
    const again = await request(lanPort, { path: `/pair?code=${code}` })
    expect(again.status).toBe(400)
    expect(again.headers["set-cookie"]).toBeUndefined()
    expect((await request(lanPort, { path: "/pair?code=WRONG234" })).status).toBe(400)
  })

  it("Next が 127.0.0.1 の絶対の URL へ移すときは、入り口から見える相対の URL に直す", async () => {
    const { gateway, files, lanPort } = await setup()
    await writeLanSettings({ enabled: true }, files)
    await gateway.reconcile()
    const { cookie } = await pair(files, lanPort)
    // 中継の先は、整理のページを http://127.0.0.1:<番号>/desktop-sessions へ移す(テストの小さなサーバーの決まり)
    const res = await request(lanPort, { path: "/desktop-sessions/housekeeping", cookie })
    expect(res.status).toBe(307)
    expect(res.headers.location).toBe("/desktop-sessions")
  })

  it("WebSocket（接続の切り替え）は 403", async () => {
    const { gateway, files, lanPort } = await setup()
    await writeLanSettings({ enabled: true }, files)
    await gateway.reconcile()
    const { cookie } = await pair(files, lanPort)
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port: lanPort,
        path: "/_next/webpack-hmr",
        headers: { host: `127.0.0.1:${lanPort}`, cookie, connection: "Upgrade", upgrade: "websocket" },
      })
      req.on("upgrade", () => resolve(101))
      req.on("response", (res) => resolve(res.statusCode ?? 0))
      req.on("error", reject)
      req.end()
    })
    expect(status).toBe(403)
  })

  it("開発のサーバーのときだけ、登録した端末の画面の更新の通知（/_next/webpack-hmr）を中継する。Host は 127.0.0.1、Cookie・Origin は外す", async () => {
    const { gateway, files, lanPort, seen } = await setup({ devHmr: true })
    await writeLanSettings({ enabled: true }, files)
    await gateway.reconcile()
    const { cookie } = await pair(files, lanPort)
    const upgrade = (headers: http.OutgoingHttpHeaders, p = "/_next/webpack-hmr") =>
      new Promise<number>((resolve, reject) => {
        const r = http.request({ host: "127.0.0.1", port: lanPort, path: p, headers: { host: `127.0.0.1:${lanPort}`, connection: "Upgrade", upgrade: "websocket", ...headers } })
        r.on("upgrade", (_res, socket) => {
          socket.destroy()
          resolve(101)
        })
        r.on("response", (res) => resolve(res.statusCode ?? 0))
        r.on("error", reject)
        r.end()
      })
    expect(await upgrade({ cookie, origin: "http://evil.example" })).toBe(101)
    const last = seen[seen.length - 1]
    expect(last).toMatchObject({ method: "UPGRADE", url: "/_next/webpack-hmr" })
    expect(last.headers.host).toMatch(/^127\.0\.0\.1:\d+$/)
    expect(last.headers.cookie).toBeUndefined()
    expect(last.headers.origin).toBeUndefined()
    expect(last.headers[LAN_HEADER]).toBe("1")
    // 鍵なし・別のパスは断る
    expect(await upgrade({})).toBe(403)
    expect(await upgrade({ cookie }, "/api/desktop-sessions")).toBe(403)
  })

  it("接続元がプライベートな IPv4 でなければ、すぐに切る（既定の制限。127.0.0.1 からの接続は切られる）", async () => {
    const { gateway, files, lanPort } = await setup({ allowLoopback: false })
    await writeLanSettings({ enabled: true }, files)
    await gateway.reconcile()
    await expect(request(lanPort, {})).rejects.toThrow()
  })
})
