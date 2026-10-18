import { NextRequest, NextResponse } from "next/server"
import { checkApiRequest } from "./lib/requestGuard"

/** /api/* 全体に対するHost/Origin/Content-Type検証。ロジック本体は lib/requestGuard.ts */
export function proxy(request: NextRequest) {
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

export const config = {
  matcher: "/api/:path*",
}
