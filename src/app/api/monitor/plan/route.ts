import { NextResponse } from "next/server"
import { rejectViaLan } from "@/lib/lanAccess/apiGuard"
import { getMonitorService } from "@/lib/monitor/monitorService"

export const dynamic = "force-dynamic"

/**
 * リソースのページの［作業と待ち］(⑭ WC-1・WC-2)。作業計画と利用上限の待ち行列を読む。
 * 読み取り専用。設定したパスとファイルの生の行は返さない。エラー文に、読んだファイルの内容を含めない。
 * スマホ(LAN の入り口の経由)には出さない(⑭ のゲート2 の L2。入り口の許可リストにも無いが、念のため重ねる)。
 */
export async function GET(req: Request) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  try {
    return NextResponse.json(await getMonitorService().plan())
  } catch {
    return NextResponse.json({ error: "作業と待ちを読み込めませんでした" }, { status: 500 })
  }
}
