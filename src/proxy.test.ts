import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"
import { config, proxy } from "./proxy"

function req(url: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(url, init)
}

describe("proxy", () => {
  it("matcher は /api 配下と、スマホから見られる4ページだけを対象にする(⑪-2。ほかのページでは proxy を動かさない)", () => {
    expect(config.matcher).toEqual(["/api/:path*", "/", "/desktop-sessions", "/desktop-sessions/usage", "/desktop-sessions/housekeeping"])
  })

  it("偽のHostは403を返し、エラーメッセージをJSONで返す", async () => {
    const res = proxy(req("http://127.0.0.1:3000/api/projects", { headers: { host: "evil.example:3000" } }))
    expect(res.status).toBe(403)
    expect(await res.json()).toHaveProperty("error")
  })

  it("偽のOriginでの書き込みは403を返す", () => {
    const res = proxy(
      req("http://127.0.0.1:3000/api/skills", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", origin: "https://evil.example", "content-type": "application/json" },
      })
    )
    expect(res.status).toBe(403)
  })

  it("JSON以外のボディでの書き込みは415を返す", () => {
    const res = proxy(
      req("http://127.0.0.1:3000/api/skills", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "text/plain", "content-length": "5" },
      })
    )
    expect(res.status).toBe(415)
  })

  it("正規のHost/Originの要求は通過させる", () => {
    const get = proxy(req("http://127.0.0.1:3000/api/projects", { headers: { host: "127.0.0.1:3000" } }))
    expect(get.status).toBe(200)
    expect(get.headers.get("x-middleware-next")).toBe("1")

    const post = proxy(
      req("http://127.0.0.1:3000/api/skills", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json", "content-length": "2" },
      })
    )
    expect(post.headers.get("x-middleware-next")).toBe("1")
  })
})
