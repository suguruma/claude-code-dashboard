import { NextResponse, type NextRequest } from "next/server"
import { getMonitorService } from "@/lib/monitor/monitorService"

export const dynamic = "force-dynamic"

/**
 * リソースのページの［負荷］の推移の図(⑭ WC-3〜WC-5・WC-11・WC-12)。
 * ?date=YYYY-MM-DD&range=1|2|6|24&center=<epoch ms>。読み取り専用。パスとファイルの生の行は返さない。
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") ?? "") ? q.get("date") : null
  const range = Number(q.get("range")) || null
  const center = Number(q.get("center")) || null
  try {
    return NextResponse.json(await getMonitorService().load({ date, rangeHours: range, center }))
  } catch {
    return NextResponse.json({ error: "見張りの記録を読み込めませんでした" }, { status: 500 })
  }
}
