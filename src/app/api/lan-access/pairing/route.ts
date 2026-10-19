import { NextResponse } from "next/server"
import { rejectViaLan } from "@/lib/lanAccess/apiGuard"
import { LanNotListeningError, issueLanPairing } from "@/lib/lanAccess/service"

export const dynamic = "force-dynamic"

/** 登録コードを出す(5分・1回限り)。PC の画面(ループバック)からだけ。コードの平文は、この応答でだけ返し、ログには出さない */
export async function POST(req: Request) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  try {
    return NextResponse.json(await issueLanPairing(Date.now()), { headers: { "cache-control": "no-store" } })
  } catch (err) {
    if (err instanceof LanNotListeningError) {
      return NextResponse.json({ error: "スマホから見る機能をオンにして、待ち受けが始まってから出してください" }, { status: 409 })
    }
    return NextResponse.json({ error: "登録コードを出せませんでした" }, { status: 500 })
  }
}
