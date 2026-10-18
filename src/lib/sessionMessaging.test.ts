import { createRequire } from "module"
import { describe, expect, it } from "vitest"
import {
  DESKTOP_SESSION_ID,
  SEND_LIMIT,
  SEND_WARN_AT,
  classifySendResult,
  isSendTool,
  sendLevel,
  sessionDeepLink,
} from "./sessionMessaging"
import {
  SYNTHETIC_SEND_LIMIT,
  SYNTHETIC_SEND_OK,
  SYNTHETIC_SEND_UNREACHABLE,
  fakeSessionId,
} from "./desktopFixtures"

// electron/externalUrl.js はElectronのmainプロセス(CommonJS)が読むファイルなので、Nodeのrequireでそのまま読む
const { isAllowedExternalUrl } = createRequire(import.meta.url)("../../electron/externalUrl.js") as {
  isAllowedExternalUrl: (url: unknown) => boolean
}

describe("classifySendResult", () => {
  it("「Not delivered」と「10 times」の両方を含めば送信上限、「Not delivered」だけなら届かなかった", () => {
    expect(classifySendResult(SYNTHETIC_SEND_LIMIT)).toBe("limit")
    expect(classifySendResult(`Not delivered: ${SEND_LIMIT} times`)).toBe("limit")
    expect(classifySendResult("Not delivered: synthetic other reason")).toBe("undelivered")
    // 回数の語だけでは上限にしない
    expect(classifySendResult("sent 10 times so far")).toBe("ok")
  })

  it("宛先が見つからない旨（No agent named … reachable）は、届かなかった送信", () => {
    expect(classifySendResult(SYNTHETIC_SEND_UNREACHABLE)).toBe("undelivered")
    expect(classifySendResult("No agent named x")).toBe("ok")
  })

  it("それ以外は ok", () => {
    expect(classifySendResult(SYNTHETIC_SEND_OK)).toBe("ok")
    expect(classifySendResult("")).toBe("ok")
  })
})

describe("送信ツールと表示の段階", () => {
  it("送信ツールは SendMessage とセッション管理の送信ツールだけ", () => {
    expect(isSendTool("SendMessage")).toBe(true)
    expect(isSendTool("mcp__ccd_session_mgmt__send_message")).toBe(true)
    expect(isSendTool("Bash")).toBe(false)
    expect(isSendTool("mcp__ccd_session_mgmt__list_sessions")).toBe(false)
  })

  it("8回以上で注意、上限または停止中で limit、0回は出さない", () => {
    expect(sendLevel(0, false)).toBe("none")
    expect(sendLevel(1, false)).toBe("ok")
    expect(sendLevel(SEND_WARN_AT - 1, false)).toBe("ok")
    expect(sendLevel(SEND_WARN_AT, false)).toBe("warn")
    expect(sendLevel(SEND_LIMIT - 1, false)).toBe("warn")
    expect(sendLevel(SEND_LIMIT, false)).toBe("limit")
    expect(sendLevel(3, true)).toBe("limit")
  })
})

describe("セッションを開くリンク", () => {
  it("Desktopのセッション識別子から claude:// のリンクを作る", () => {
    const id = fakeSessionId(1)
    expect(sessionDeepLink(id)).toBe(`claude://claude.ai/epitaxy/${id}`)
  })

  it("Desktopのセッション識別子でなければ作らない（会話ログだけの縮退表示のID・記号・空）", () => {
    expect(sessionDeepLink("11111111-1111-4111-8111-000000000001")).toBeNull()
    expect(sessionDeepLink("local_a/../b")).toBeNull()
    expect(sessionDeepLink("local_a?x=1")).toBeNull()
    expect(sessionDeepLink("local_")).toBeNull()
    expect(sessionDeepLink("")).toBeNull()
    expect(DESKTOP_SESSION_ID.test(fakeSessionId(2))).toBe(true)
  })

  it("アプリ側が作るリンクは、Electronのメインプロセスが許可する形式と一致する", () => {
    expect(isAllowedExternalUrl(sessionDeepLink(fakeSessionId(3)))).toBe(true)
  })
})

describe("Electron: 外部で開いてよいURLの検証", () => {
  const id = fakeSessionId(4)

  it("claude://claude.ai/epitaxy/local_<ID> の形式だけを許可する", () => {
    expect(isAllowedExternalUrl(`claude://claude.ai/epitaxy/${id}`)).toBe(true)
  })

  it("他のスキーム・ホスト・パス・余分な部分は拒否する", () => {
    const rejected = [
      `https://claude.ai/epitaxy/${id}`,
      `http://claude.ai/epitaxy/${id}`,
      "file:///C:/Windows/System32/calc.exe",
      "javascript:alert(1)",
      `claude://evil.example/epitaxy/${id}`,
      `claude://claude.ai/other/${id}`,
      `claude://claude.ai/epitaxy/${id}/extra`,
      `claude://claude.ai/epitaxy/${id}?x=1`,
      `claude://claude.ai/epitaxy/${id}#x`,
      `claude://claude.ai/epitaxy/${id} `,
      ` claude://claude.ai/epitaxy/${id}`,
      `CLAUDE://claude.ai/epitaxy/${id}`,
      "claude://claude.ai/epitaxy/abc",
      "claude://claude.ai/epitaxy/local_",
      "claude://claude.ai/epitaxy/local_a b",
      `claude://claude.ai/epitaxy/local_${"a".repeat(150)}`,
      `claude://claude.ai/epitaxy/../${id}`,
      "",
    ]
    for (const url of rejected) expect(isAllowedExternalUrl(url), url).toBe(false)
  })

  it("文字列以外は拒否する", () => {
    for (const value of [null, undefined, 1, {}, [], [`claude://claude.ai/epitaxy/${id}`]]) {
      expect(isAllowedExternalUrl(value)).toBe(false)
    }
  })
})
