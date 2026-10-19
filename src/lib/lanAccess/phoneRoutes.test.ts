import { existsSync } from "fs"
import path from "path"
import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"
import { config as proxyConfig, proxy } from "../../proxy"
import { LAN_HEADER, LAN_PAGES } from "./gatewayPolicy"
import { PHONE_SEGMENT, phoneRewritePath } from "./phoneRoutes"

const APP_DIR = path.join(__dirname, "..", "..", "app")

describe("スマホ用のページへの振り替え(⑪-2)", () => {
  it("入り口の印があるときだけ、4ページを app/phone の下へ振り替える", () => {
    expect(phoneRewritePath("/", true)).toBe("/phone")
    expect(phoneRewritePath("/desktop-sessions", true)).toBe("/phone/desktop-sessions")
    expect(phoneRewritePath("/desktop-sessions/usage", true)).toBe("/phone/desktop-sessions/usage")
    expect(phoneRewritePath("/desktop-sessions/housekeeping", true)).toBe("/phone/desktop-sessions/housekeeping")
    for (const p of LAN_PAGES) expect(phoneRewritePath(p, false)).toBeNull()
    for (const p of ["/rules", "/desktop-sessions/org", "/lan-access", "/phone"]) expect(phoneRewritePath(p, true)).toBeNull()
  })

  it("4ページのそれぞれに、スマホ用のページがある", () => {
    for (const p of LAN_PAGES) {
      const dir = path.join(APP_DIR, PHONE_SEGMENT, ...p.split("/").filter(Boolean))
      expect(existsSync(path.join(dir, "page.tsx")), p).toBe(true)
    }
  })

  it("proxy の対象(matcher)に、4ページがすべて入っている", () => {
    for (const p of LAN_PAGES) expect(proxyConfig.matcher, p).toContain(p)
    expect(proxyConfig.matcher).toContain("/api/:path*")
  })

  it("proxy：印のある要求は振り替え(検索はそのまま)、印の無い要求はそのまま通す", () => {
    const viaLan = proxy(new NextRequest("http://127.0.0.1:3000/desktop-sessions?group=group_a", { headers: { [LAN_HEADER]: "1" } }))
    const rewritten = new URL(viaLan.headers.get("x-middleware-rewrite") ?? "http://x/")
    expect(rewritten.pathname + rewritten.search).toBe("/phone/desktop-sessions?group=group_a")
    const pc = proxy(new NextRequest("http://127.0.0.1:3000/desktop-sessions"))
    expect(pc.headers.get("x-middleware-rewrite")).toBeNull()
    expect(pc.headers.get("x-middleware-next")).toBe("1")
  })

  it("proxy：/api の検査は今のまま(印があっても振り替えない)", () => {
    const res = proxy(new NextRequest("http://evil.example/api/rules", { headers: { [LAN_HEADER]: "1" } }))
    expect(res.status).toBe(403)
    expect(res.headers.get("x-middleware-rewrite")).toBeNull()
  })
})
