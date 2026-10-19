import { NextResponse } from "next/server"
import { LAN_HEADER } from "./config"
import { redactForLan } from "./redact"

/** LAN の入り口を通った要求か(入り口が付ける印で見分ける。ループバックの要求がこれを付けても、できることは減るだけ) */
export function viaLan(req: Request): boolean {
  return req.headers.get(LAN_HEADER) !== null
}

/** 管理の API は、入り口を通った要求を断る(入り口の許可リストにも無いが、念のため重ねる) */
export function rejectViaLan(req: Request): NextResponse | null {
  return viaLan(req) ? NextResponse.json({ error: "この操作は PC の画面からだけできます" }, { status: 403 }) : null
}

/** 読み取りの API の応答。入り口を通った要求には、フォルダのパスを隠して返す */
export function lanAwareJson(req: Request, data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(viaLan(req) ? redactForLan(data) : data, init)
}
