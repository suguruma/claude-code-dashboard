import { NextResponse } from "next/server"
import { rejectViaLan } from "@/lib/lanAccess/apiGuard"
import { getMonitorService } from "@/lib/monitor/monitorService"

export const dynamic = "force-dynamic"

/**
 * PC の警告の要約(⑭ WC-6・WC-12)。ホームの帯・サイドバーの「！」・通知が読む。直近24時間の CPU とメモリの最後の帯だけ。
 * 読み取り専用。パスとファイルの生の行は返さない。
 * スマホ(LAN の入り口の経由)には出さない(⑭ のゲート2 の L2。入り口の許可リストにも無いが、念のため重ねる)。
 */
export async function GET(req: Request) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  try {
    return NextResponse.json(await getMonitorService().alerts())
  } catch {
    return NextResponse.json({ error: "PC の警告を読み込めませんでした" }, { status: 500 })
  }
}
