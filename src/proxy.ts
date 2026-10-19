import { NextRequest, NextResponse } from "next/server"
import { LAN_HEADER } from "./lib/lanAccess/gatewayPolicy"
import { phoneRewritePath } from "./lib/lanAccess/phoneRoutes"
import { checkApiRequest } from "./lib/requestGuard"

/**
 * /api/* 全体に対するHost/Origin/Content-Type検証。ロジック本体は lib/requestGuard.ts。
 * スマホから見られる4ページは、LAN の入り口の経由(印付き)のときだけ、スマホ用のページ(app/phone)へ振り替える(⑪-2)。
 * 印を付けられるのは入り口だけではないが、ループバックから付けても、表示が読み取り専用のスマホ用になるだけで、できることは増えない。
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const result = checkApiRequest({
      method: request.method,
      host: request.headers.get("host"),
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      contentType: request.headers.get("content-type"),
      contentLength: request.headers.get("content-length"),
      transferEncoding: request.headers.get("transfer-encoding"),
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status })
    }
    return NextResponse.next()
  }

  const phonePath = phoneRewritePath(pathname, request.headers.get(LAN_HEADER) !== null)
  if (phonePath) {
    const url = request.nextUrl.clone()
    url.pathname = phonePath
    return NextResponse.rewrite(url)
  }
  return NextResponse.next()
}

export const config = {
  // スマホから見られる4ページ(lanAccess/gatewayPolicy.ts の LAN_PAGES)を足すときは、ここにも足す(テストで確かめる)
  matcher: ["/api/:path*", "/", "/desktop-sessions", "/desktop-sessions/usage", "/desktop-sessions/housekeeping"],
}
