import { createRequire } from "module"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CloudSessionsLink } from "@/components/desktopSessions/CloudSessionsLink"
import { CLOUD_SESSIONS_NOTE, CLOUD_SESSIONS_URL } from "./cloudSessions"

// electron/ の2つは Electron のメインプロセス(CommonJS)が読むファイルなので、Node の require でそのまま読む
const require = createRequire(import.meta.url)
const { isAllowedExternalUrl } = require("../../electron/externalUrl.js") as { isAllowedExternalUrl: (url: unknown) => boolean }
const { navigationDecision } = require("../../electron/origin.js") as {
  navigationDecision: (url: unknown, appOrigin: string | null) => "allow" | "external" | "block"
}

describe("[CL-1] クラウドのセッションを claude.ai で開くボタン", () => {
  it("[CL-1] exe の許可リストは https://claude.ai/code だけを完全一致で通す", () => {
    expect(CLOUD_SESSIONS_URL).toBe("https://claude.ai/code")
    expect(isAllowedExternalUrl(CLOUD_SESSIONS_URL)).toBe(true)
    for (const url of [
      "https://claude.ai/code/x",
      "http://claude.ai/code",
      "https://claude.ai/code?x",
      "https://claude.ai/code#x",
      "https://claude.ai/code/",
      "https://claude.ai/",
      "https://claude.ai/codex",
      "https://evil.example/https://claude.ai/code",
      " https://claude.ai/code",
    ]) {
      expect(isAllowedExternalUrl(url), url).toBe(false)
    }
  })

  it("[CL-1] exe では、新しい窓を開く代わりに既定のブラウザで開く(窓の中では開かない)", () => {
    expect(navigationDecision(CLOUD_SESSIONS_URL, "http://127.0.0.1:3000")).toBe("external")
  })

  it("[CL-1] ボタンは新しいタブで開くリンクで、opener と referrer を渡さない。中身は見られない旨の1行を添える", () => {
    const html = renderToStaticMarkup(createElement(CloudSessionsLink))
    expect(html).toContain(`href="${CLOUD_SESSIONS_URL}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain("クラウドのセッション（claude.ai で開く")
    expect(html).toContain(CLOUD_SESSIONS_NOTE)
    expect(html).not.toMatch(/<iframe|<webview/)
  })
})
