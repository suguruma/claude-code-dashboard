import { describe, expect, it } from "vitest"
import { checkApiRequest, type GuardInput } from "./requestGuard"

function input(overrides: Partial<GuardInput> = {}): GuardInput {
  return {
    method: "GET",
    host: "127.0.0.1:3000",
    origin: null,
    secFetchSite: null,
    contentType: null,
    contentLength: null,
    transferEncoding: null,
    ...overrides,
  }
}

describe("checkApiRequest: Host", () => {
  it.each(["127.0.0.1:3000", "localhost:3000", "[::1]:3000", "LOCALHOST:41234", "127.0.0.1"])(
    "%s は許可する",
    (host) => {
      expect(checkApiRequest(input({ host }))).toEqual({ ok: true })
    }
  )

  it.each(["evil.example:3000", "192.168.0.10:3000", "localhost.evil.example:3000", "127.0.0.1.evil.example", "0.0.0.0:3000", "", null])(
    "%s は403で拒否する(DNS rebinding・LAN経由)",
    (host) => {
      expect(checkApiRequest(input({ host }))).toMatchObject({ ok: false, status: 403 })
    }
  )
})

describe("checkApiRequest: Origin", () => {
  it("Hostと同一のOriginは許可する", () => {
    expect(checkApiRequest(input({ method: "POST", origin: "http://127.0.0.1:3000" }))).toEqual({ ok: true })
  })

  it("別ポートのlocalhostからのOriginは拒否する", () => {
    expect(checkApiRequest(input({ method: "POST", origin: "http://localhost:8080", host: "localhost:3000" }))).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it("別サイトのOriginは書き込み・読み取りとも拒否する", () => {
    expect(checkApiRequest(input({ method: "POST", origin: "https://evil.example" }))).toMatchObject({ ok: false, status: 403 })
    expect(checkApiRequest(input({ method: "GET", origin: "https://evil.example" }))).toMatchObject({ ok: false, status: 403 })
  })

  it("Origin: null や解釈できないOriginは拒否する", () => {
    expect(checkApiRequest(input({ method: "POST", origin: "null" }))).toMatchObject({ ok: false, status: 403 })
    expect(checkApiRequest(input({ method: "POST", origin: "not a url" }))).toMatchObject({ ok: false, status: 403 })
  })

  it("Originなしの書き込みは、Sec-Fetch-Siteが無ければ(curl等)許可する", () => {
    expect(checkApiRequest(input({ method: "POST" }))).toEqual({ ok: true })
  })

  it("Originなしの書き込みでも、Sec-Fetch-Siteがクロスサイトなら拒否する", () => {
    expect(checkApiRequest(input({ method: "POST", secFetchSite: "cross-site" }))).toMatchObject({ ok: false, status: 403 })
    expect(checkApiRequest(input({ method: "DELETE", secFetchSite: "same-site" }))).toMatchObject({ ok: false, status: 403 })
    expect(checkApiRequest(input({ method: "POST", secFetchSite: "same-origin" }))).toEqual({ ok: true })
  })
})

describe("checkApiRequest: Content-Type", () => {
  it("ボディ付きの書き込みはapplication/jsonのみ許可する", () => {
    const json = { method: "POST", origin: "http://127.0.0.1:3000", contentLength: "12" }
    expect(checkApiRequest(input({ ...json, contentType: "application/json" }))).toEqual({ ok: true })
    expect(checkApiRequest(input({ ...json, contentType: "application/json; charset=utf-8" }))).toEqual({ ok: true })
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", null]) {
      expect(checkApiRequest(input({ ...json, contentType }))).toMatchObject({ ok: false, status: 415 })
    }
  })

  it("Transfer-Encoding指定(チャンク送信)のボディも同様に検証する", () => {
    expect(
      checkApiRequest(input({ method: "PATCH", transferEncoding: "chunked", contentType: "text/plain" }))
    ).toMatchObject({ ok: false, status: 415 })
  })

  it("ボディ無しの書き込み(POST/DELETE)はContent-Typeなしで許可する", () => {
    expect(checkApiRequest(input({ method: "POST", origin: "http://127.0.0.1:3000" }))).toEqual({ ok: true })
    expect(checkApiRequest(input({ method: "DELETE", contentLength: "0" }))).toEqual({ ok: true })
  })

  it("GETではContent-Typeを問わない", () => {
    expect(checkApiRequest(input({ method: "GET", contentType: "text/plain" }))).toEqual({ ok: true })
  })
})
