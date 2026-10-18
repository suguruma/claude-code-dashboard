import { createRequire } from "module"
import { describe, expect, it } from "vitest"

// electron/*.js はElectronのmainプロセス(CommonJS)が読むファイルなので、Nodeのrequireでそのまま読む（electronPort.test.ts と同じ方法）
const require = createRequire(import.meta.url)
const { appOriginOf, isAppUrl, navigationDecision, isTrustedIpcEvent } = require("../../electron/origin.js") as {
  appOriginOf: (port: unknown) => string | null
  isAppUrl: (url: unknown, appOrigin: string | null) => boolean
  navigationDecision: (url: unknown, appOrigin: string | null) => "allow" | "external" | "block"
  isTrustedIpcEvent: (event: unknown, mainWebContents: unknown, appOrigin: string | null) => boolean
}
const { isAllowedExternalUrl } = require("../../electron/externalUrl.js") as {
  isAllowedExternalUrl: (url: unknown) => boolean
}
const { portFallbackNotice, createNoticeSlot } = require("../../electron/startupNotice.js") as {
  portFallbackNotice: (arg: { port: number; isPreferred: boolean; preferredPort: number }) => unknown
  createNoticeSlot: () => { set: (n: unknown) => void; take: () => unknown }
}

const PORT = 38417
const ORIGIN = `http://127.0.0.1:${PORT}`

describe("appOriginOf", () => {
  it("ポートから http://127.0.0.1:<ポート> を作る。ポートが正しくなければ null", () => {
    expect(appOriginOf(PORT)).toBe(ORIGIN)
    expect(appOriginOf(1)).toBe("http://127.0.0.1:1")
    expect(appOriginOf(65535)).toBe("http://127.0.0.1:65535")
    for (const bad of [0, -1, 65536, 1.5, Number.NaN, "38417", null, undefined]) {
      expect(appOriginOf(bad)).toBeNull()
    }
  })
})

describe("navigationDecision: アプリのオリジンだけ移動してよい", () => {
  it("アプリのオリジンの URL（パス・クエリ・ハッシュつき）は allow", () => {
    for (const url of [ORIGIN, `${ORIGIN}/`, `${ORIGIN}/trace`, `${ORIGIN}/desktop-sessions?group=a#top`, `${ORIGIN}/#hash`]) {
      expect(navigationDecision(url, ORIGIN)).toBe("allow")
      expect(isAppUrl(url, ORIGIN)).toBe(true)
    }
  })

  it("外部のページ・別のポート・別のホスト名・別のスキームは block", () => {
    const blocked = [
      "https://example.com/",
      "http://example.com/",
      `http://127.0.0.1:${PORT + 1}/`,
      `http://localhost:${PORT}/`,
      `https://127.0.0.1:${PORT}/`,
      "http://127.0.0.1/",
      "http://[::1]:38417/",
      `http://0.0.0.0:${PORT}/`,
    ]
    for (const url of blocked) expect(navigationDecision(url, ORIGIN), url).toBe("block")
  })

  it("オリジンに見せかけた URL（ポートの後ろ・ユーザー情報・サブドメイン）は block", () => {
    const blocked = [
      `${ORIGIN}.example.com/`,
      `http://127.0.0.1:${PORT}@example.com/`,
      `http://example.com@127.0.0.1:${PORT}.example.com/`,
      `http://127.0.0.1.example.com:${PORT}/`,
      `http://example.com/?u=${ORIGIN}/`,
      `http://example.com/${ORIGIN}`,
    ]
    for (const url of blocked) expect(navigationDecision(url, ORIGIN), url).toBe("block")
  })

  it("file:・javascript:・data:・blob:・about: は block", () => {
    const blocked = [
      "file:///C:/Windows/System32/calc.exe",
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "blob:http://127.0.0.1:38417/abc",
      "about:blank",
    ]
    for (const url of blocked) expect(navigationDecision(url, ORIGIN), url).toBe("block")
  })

  it("空文字・解析できない文字列・文字列でない値は block（例外にならない）", () => {
    for (const bad of ["", "   ", "not a url", "//127.0.0.1:38417/", "/trace", "http://", null, undefined, 3, {}]) {
      expect(navigationDecision(bad, ORIGIN)).toBe("block")
      expect(isAppUrl(bad, ORIGIN)).toBe(false)
    }
  })

  it("アプリのオリジンがまだ決まっていない（null）あいだは、アプリの URL でもすべて block", () => {
    expect(navigationDecision(`${ORIGIN}/`, null)).toBe("block")
    expect(isAppUrl(`${ORIGIN}/`, null)).toBe(false)
  })

  it("許可リストにある外部 URL は external（窓では開かず、既定のアプリ・ブラウザで開く）。それ以外の外部 URL は block", () => {
    expect(navigationDecision("claude://claude.ai/epitaxy/local_abc-123_X", ORIGIN)).toBe("external")
    expect(navigationDecision("https://claude.com/claude-code", ORIGIN)).toBe("external")
    expect(navigationDecision("https://claude.com/claude-code/", ORIGIN)).toBe("block")
    expect(navigationDecision("https://claude.com/", ORIGIN)).toBe("block")
  })
})

describe("isAllowedExternalUrl: 許可リストは完全一致の2種類だけ", () => {
  it("claude:// のセッションのリンクと、Claude Code の紹介ページだけを許可する", () => {
    expect(isAllowedExternalUrl("claude://claude.ai/epitaxy/local_0123-abcd_EF")).toBe(true)
    expect(isAllowedExternalUrl("https://claude.com/claude-code")).toBe(true)
  })

  it("形が少しでも違うもの（スキーム・ホスト・パス・末尾・クエリ・前方一致・部分一致）は許可しない", () => {
    const rejected = [
      "http://claude.com/claude-code",
      "https://claude.com/claude-code/",
      "https://claude.com/claude-code?x=1",
      "https://claude.com/claude-code#top",
      "https://claude.com/claude-code/extra",
      "https://claude.com/",
      "https://www.claude.com/claude-code",
      "https://claude.com.example.com/claude-code",
      "https://example.com/https://claude.com/claude-code",
      " https://claude.com/claude-code",
      "https://claude.com/claude-code ",
      "https://CLAUDE.com/claude-code",
      "claude://claude.ai/epitaxy/local_",
      "claude://claude.ai/epitaxy/local_a b",
      "claude://claude.ai/epitaxy/local_abc/extra",
      "claude://claude.ai/epitaxy/abc",
      "claude://other.example/epitaxy/local_abc",
      "claude://claude.ai/epitaxy/local_abc?x=1",
      "file:///C:/Windows/System32/calc.exe",
      "ms-msdt:/id",
      "javascript:alert(1)",
      `claude://claude.ai/epitaxy/local_${"a".repeat(101)}`,
      `https://claude.com/claude-code${"/".repeat(200)}`,
    ]
    for (const url of rejected) expect(isAllowedExternalUrl(url), url).toBe(false)
  })

  it("文字列でない値は許可しない", () => {
    for (const bad of [null, undefined, 3, {}, [], true]) expect(isAllowedExternalUrl(bad)).toBe(false)
  })
})

describe("isTrustedIpcEvent: IPC の送り元の確認", () => {
  const main = { id: "main" }
  const frame = (url: string, parent: unknown = null) => ({ url, parent })
  const event = (sender: unknown, senderFrame: unknown) => ({ sender, senderFrame })

  it("メインウィンドウのメインフレームで、そのページがアプリのオリジンなら許可", () => {
    expect(isTrustedIpcEvent(event(main, frame(`${ORIGIN}/trace`)), main, ORIGIN)).toBe(true)
    expect(isTrustedIpcEvent(event(main, frame(ORIGIN + "/")), main, ORIGIN)).toBe(true)
  })

  it("senderFrame が無い（破棄された）ときは拒否", () => {
    expect(isTrustedIpcEvent(event(main, null), main, ORIGIN)).toBe(false)
    expect(isTrustedIpcEvent(event(main, undefined), main, ORIGIN)).toBe(false)
  })

  it("フレームのページが別のオリジン（外部ページ・別のポート・file:）なら拒否", () => {
    for (const url of ["https://example.com/", `http://127.0.0.1:${PORT + 1}/`, `http://localhost:${PORT}/`, "file:///C:/a.html", "", "about:blank"]) {
      expect(isTrustedIpcEvent(event(main, frame(url)), main, ORIGIN), url).toBe(false)
    }
  })

  it("メインフレームでない（親のある）フレームからは、アプリのオリジンでも拒否", () => {
    expect(isTrustedIpcEvent(event(main, frame(`${ORIGIN}/`, { id: "parent" })), main, ORIGIN)).toBe(false)
  })

  it("別の webContents（スプラッシュなど）からは、アプリのオリジンでも拒否", () => {
    expect(isTrustedIpcEvent(event({ id: "other" }, frame(`${ORIGIN}/`)), main, ORIGIN)).toBe(false)
  })

  it("メインウィンドウが無い・アプリのオリジンが未確定・event が無いときは拒否", () => {
    expect(isTrustedIpcEvent(event(main, frame(`${ORIGIN}/`)), null, ORIGIN)).toBe(false)
    expect(isTrustedIpcEvent(event(main, frame(`${ORIGIN}/`)), main, null)).toBe(false)
    expect(isTrustedIpcEvent(null, main, ORIGIN)).toBe(false)
    expect(isTrustedIpcEvent(undefined, main, ORIGIN)).toBe(false)
  })
})

describe("起動の通知（優先ポートが使えなかったときの帯）", () => {
  it("優先ポートが使えなかったときだけ通知を作る。優先ポートで起動できたときは null", () => {
    expect(portFallbackNotice({ port: 51234, isPreferred: false, preferredPort: PORT })).toEqual({
      kind: "port-fallback",
      port: 51234,
      preferredPort: PORT,
    })
    expect(portFallbackNotice({ port: PORT, isPreferred: true, preferredPort: PORT })).toBeNull()
  })

  it("通知は1回だけ渡せる。渡したあと・最初から無いときは null（再読み込みでは出ない）", () => {
    const slot = createNoticeSlot()
    expect(slot.take()).toBeNull()

    slot.set(portFallbackNotice({ port: 51234, isPreferred: false, preferredPort: PORT }))
    expect(slot.take()).toEqual({ kind: "port-fallback", port: 51234, preferredPort: PORT })
    expect(slot.take()).toBeNull()
    expect(slot.take()).toBeNull()
  })

  it("優先ポートで起動できたときは、入れ物に null を入れても何も渡さない", () => {
    const slot = createNoticeSlot()
    slot.set(portFallbackNotice({ port: PORT, isPreferred: true, preferredPort: PORT }))
    expect(slot.take()).toBeNull()
  })
})
