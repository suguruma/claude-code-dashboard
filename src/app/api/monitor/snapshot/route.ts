import { NextResponse, type NextRequest } from "next/server"
import { getMonitorService } from "@/lib/monitor/monitorService"

export const dynamic = "force-dynamic"

/**
 * 選んだ時刻に動いていたもの(⑭ WC-4・WC-13)。?at=<epoch ms>。前後1分の記録のセッションとセッションの外のプログラム。
 * 読み取り専用。パスとファイルの生の行は返さない。
 */
export async function GET(req: NextRequest) {
  const at = Number(req.nextUrl.searchParams.get("at"))
  if (!Number.isFinite(at) || at <= 0) return NextResponse.json({ error: "時刻の指定が正しくありません" }, { status: 400 })
  try {
    return NextResponse.json(await getMonitorService().snapshot(at))
  } catch {
    return NextResponse.json({ error: "見張りの記録を読み込めませんでした" }, { status: 500 })
  }
}
