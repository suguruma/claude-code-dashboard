import { promises as fs } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"
import { decideLanRequest, isAllowedLanPath, parseLanPath, readCookie, type LanPolicyInput } from "./gatewayPolicy"

const base: LanPolicyInput = {
  method: "GET",
  host: "192.168.10.5:38418",
  rawUrl: "/",
  isUpgrade: false,
  localAddresses: ["192.168.10.5"],
  port: 38418,
  deviceValid: true,
}
const decide = (o: Partial<LanPolicyInput>) => decideLanRequest({ ...base, ...o })

describe("LAN の入り口の判定", () => {
  it("Host は「この PC のプライベートな IPv4:入り口の番号」だけ。名前・127.0.0.1・localhost・別の番号・Host なしは 403", () => {
    expect(decide({}).action).toBe("forward")
    expect(decide({ host: "192.168.10.5:38418".toUpperCase() }).action).toBe("forward")
    for (const host of ["evil.example:38418", "127.0.0.1:38418", "localhost:38418", "192.168.10.5:3000", "192.168.10.5", "192.168.10.6:38418", "", null]) {
      expect(decide({ host }), String(host)).toMatchObject({ action: "reject", status: 403 })
    }
  })

  it("GET・HEAD 以外は、有効な鍵があっても、どのパスでも 403（書き込みは PC からだけ）", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]) {
      for (const rawUrl of ["/api/desktop-sessions/settings", "/api/rules", "/", "/pair?code=ABCDEFGH"]) {
        expect(decide({ method, rawUrl }), `${method} ${rawUrl}`).toMatchObject({ action: "reject", status: 403 })
      }
    }
    expect(decide({ method: "HEAD" }).action).toBe("forward")
  })

  it("接続の切り替え（WebSocket）は 403。開発のサーバーの画面の更新の通知だけ、登録した端末から通す", () => {
    expect(decide({ isUpgrade: true, rawUrl: "/_next/webpack-hmr" })).toMatchObject({ action: "reject", status: 403 })
    expect(decide({ isUpgrade: true, rawUrl: "/_next/webpack-hmr?page=x", devHmr: true })).toEqual({ action: "upgrade", pathname: "/_next/webpack-hmr", search: "?page=x" })
    // 開発のサーバーでも、鍵なし・別のパス・別の Host・GET 以外は断る
    expect(decide({ isUpgrade: true, rawUrl: "/_next/webpack-hmr", devHmr: true, deviceValid: false })).toMatchObject({ action: "reject" })
    expect(decide({ isUpgrade: true, rawUrl: "/api/desktop-sessions", devHmr: true })).toMatchObject({ action: "reject" })
    expect(decide({ isUpgrade: true, rawUrl: "/_next/webpack-hmr", devHmr: true, host: "evil.example:38418" })).toMatchObject({ action: "reject" })
    expect(decide({ isUpgrade: true, rawUrl: "/_next/webpack-hmr", devHmr: true, method: "POST" })).toMatchObject({ action: "reject" })
  })

  it("鍵なしの GET は 401（ページは案内、API は JSON）。取り消した・期限切れの鍵も、判定には deviceValid=false で渡る", () => {
    expect(decide({ deviceValid: false, rawUrl: "/" })).toEqual({ action: "needKey", api: false })
    expect(decide({ deviceValid: false, rawUrl: "/desktop-sessions" })).toEqual({ action: "needKey", api: false })
    expect(decide({ deviceValid: false, rawUrl: "/api/desktop-sessions" })).toEqual({ action: "needKey", api: true })
  })

  it("/pair はコードを取り出して入り口の中で処理する（鍵が無くても）", () => {
    expect(decide({ deviceValid: false, rawUrl: "/pair?code=ABCD2345" })).toEqual({ action: "pair", code: "ABCD2345" })
    expect(decide({ deviceValid: false, rawUrl: "/pair" })).toEqual({ action: "pair", code: null })
  })

  it("鍵ありの GET は、許可リストの4ページ・6つの API・画面の部品だけ通る", () => {
    const allowed = [
      "/",
      "/desktop-sessions",
      "/desktop-sessions/usage",
      "/desktop-sessions/housekeeping",
      "/api/desktop-sessions",
      "/api/desktop-sessions/local_0123abcd-ef",
      "/api/desktop-sessions/flow?group=g1&since=1",
      "/api/desktop-sessions/housekeeping",
      "/api/desktop-sessions/settings",
      "/api/usage",
      "/_next/static/chunks/app.js",
      "/favicon.ico",
      "/desktop-sessions?_rsc=abc",
    ]
    for (const rawUrl of allowed) expect(decide({ rawUrl }).action, rawUrl).toBe("forward")
  })

  it("鍵があっても、許可リストの外は 403", () => {
    const denied = [
      "/rules",
      "/skills",
      "/memory",
      "/org-rules",
      "/help",
      "/settings",
      "/lan-access",
      "/session-monitor",
      "/api/rules",
      "/api/memory",
      "/api/org-rules",
      "/api/projects",
      "/api/browse-dir/preview?path=C:/",
      "/api/lan-access",
      "/api/lan-access/pairing",
      "/desktop-sessions/org",
      "/desktop-sessions/",
      "/api/desktop-sessions/a/b",
    ]
    for (const rawUrl of denied) expect(decide({ rawUrl }), rawUrl).toMatchObject({ action: "reject", status: 403 })
  })

  it("`..`・`%`・`\\`・`//` で書いたパスは、正規化の食い違いを避けて 403", () => {
    for (const rawUrl of [
      "/api/desktop-sessions/../rules",
      "/api/desktop-sessions/%2e%2e/rules",
      "/api/%72ules",
      "/_next/static/%2e%2e/api/rules",
      "/desktop-sessions/./usage",
      "/api\\rules",
      "//evil.example/",
      "http://192.168.10.5:38418/api/rules",
    ]) {
      expect(decide({ rawUrl }), rawUrl).toMatchObject({ action: "reject", status: 403 })
    }
    expect(parseLanPath("/api/usage?x=%2F")).toEqual({ pathname: "/api/usage", search: "?x=%2F" })
  })

  it("開発のサーバー（Turbopack）の部品の名前（%40・%5B・%5D）は、/_next/static/ の下なら通す。元の書き方のまま中継する", () => {
    // 合成データの開発のサーバーで、4ページが読み込んだ実際の名前
    const turbopack = [
      "/_next/static/chunks/%5Broot-of-the-server%5D__0ofa7dm._.css",
      "/_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_04wbvi4._.js",
      "/_next/static/chunks/1vjf_%40base-ui_react_1od-dxq._.js",
      "/_next/static/chunks/1vjf_%40base-ui_react_floating-ui-react_0k99jpw._.js",
      "/_next/static/chunks/1vjf_%40base-ui_react_menu_02t-l6b._.js",
      "/_next/static/chunks/1vjf_%40swc_helpers_cjs_0-_ml10._.js",
    ]
    for (const rawUrl of turbopack) {
      expect(decide({ rawUrl }), rawUrl).toEqual({ action: "forward", pathname: rawUrl, search: "" })
    }
    expect(decide({ rawUrl: "/_next/static/chunks/%5Broot%5D.css?v=1" })).toEqual({ action: "forward", pathname: "/_next/static/chunks/%5Broot%5D.css", search: "?v=1" })
  })

  it("/_next/static/ の下でも、/・\\・..・%・NUL・制御文字に戻る %、16進でない %、ほかの場所の % は 403", () => {
    for (const rawUrl of [
      "/_next/static/chunks/a%2Fb.js",
      "/_next/static/chunks/a%2fb.js",
      "/_next/static/chunks/a%5Cb.js",
      "/_next/static/%2e%2e/%2e%2e/api/rules",
      "/_next/static/chunks/%2E%2E%2Fx.js",
      "/_next/static/chunks/a%25b.js",
      "/_next/static/chunks/a%00.js",
      "/_next/static/chunks/a%0a.js",
      "/_next/static/chunks/a%zz.js",
      "/_next/static/chunks/a%4.js",
      "/_next/static/chunks/a%.js",
      "/_next/static/chunks/%40..%40.js",
      "/_next/%40static/x.js",
      "/api/desktop-sessions/%40x",
      "/desktop-sessions%5B",
    ]) {
      expect(decide({ rawUrl }), rawUrl).toMatchObject({ action: "reject", status: 403 })
    }
  })

  it("開発のフォントの置き場所（/__nextjs_font/）は、開発のサーバーのときだけ、決まった形の名前だけ通す", () => {
    expect(decide({ rawUrl: "/__nextjs_font/geist-latin.woff2", devAssets: true })).toEqual({ action: "forward", pathname: "/__nextjs_font/geist-latin.woff2", search: "" })
    expect(decide({ rawUrl: "/__nextjs_font/geist-latin.woff2" })).toMatchObject({ action: "reject" })
    expect(decide({ rawUrl: "/__nextjs_font/geist-latin.woff2", devAssets: true, deviceValid: false })).toMatchObject({ action: "needKey" })
    for (const rawUrl of ["/__nextjs_font/../api/rules", "/__nextjs_font/a/b.woff2", "/__nextjs_font/", "/__nextjs_font/.hidden", "/__nextjs_font/a%2Fb", "/__nextjs_original-stack-frames"]) {
      expect(decide({ rawUrl, devAssets: true }), rawUrl).toMatchObject({ action: "reject" })
    }
  })

  it("詳細の API は、Desktop の識別子（local_…）か UUID だけ。/api/desktop-sessions/ の下のほかの名前は 403", () => {
    expect(isAllowedLanPath("/api/desktop-sessions/local_0123abcd-ef")).toBe(true)
    expect(isAllowedLanPath("/api/desktop-sessions/00000000-0000-4000-8000-000000000001")).toBe(true)
    for (const name of ["export", "backup", "settings2", "org", "local", "abc123"]) {
      expect(isAllowedLanPath(`/api/desktop-sessions/${name}`), name).toBe(false)
    }
  })

  it("/api/desktop-sessions の下の API のルートは、スマホに開くものとして決めた5つだけ（足したら、この表と許可リストを見直す）", async () => {
    const root = path.join(process.cwd(), "src", "app", "api", "desktop-sessions")
    const routes: string[] = []
    async function walk(dir: string) {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) await walk(full)
        else if (e.name === "route.ts") routes.push("/api/desktop-sessions" + path.relative(root, dir).split(path.sep).map((s) => (s ? `/${s}` : "")).join(""))
      }
    }
    await walk(root)
    expect(routes.sort()).toEqual([
      "/api/desktop-sessions",
      "/api/desktop-sessions/[id]",
      "/api/desktop-sessions/flow",
      "/api/desktop-sessions/housekeeping",
      "/api/desktop-sessions/settings",
    ])
    for (const r of routes) {
      const sample = r.replace("[id]", "local_0123abcd")
      expect(isAllowedLanPath(sample), r).toBe(true)
    }
  })

  it("許可リストの関数とクッキーの読み取り", () => {
    expect(isAllowedLanPath("/api/desktop-sessions/settings")).toBe(true)
    expect(isAllowedLanPath("/api/desktop-sessions/settings/x")).toBe(false)
    expect(readCookie("a=1; ccd_lan_key=abc; b=2", "ccd_lan_key")).toBe("abc")
    expect(readCookie("ccd_lan_key=", "ccd_lan_key")).toBeNull()
    expect(readCookie(undefined, "ccd_lan_key")).toBeNull()
  })
})
