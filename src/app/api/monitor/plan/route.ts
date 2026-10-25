import { NextResponse } from "next/server"
import { getMonitorService } from "@/lib/monitor/monitorService"

export const dynamic = "force-dynamic"

/**
 * リソースのページの［作業と待ち］(⑭ WC-1・WC-2)。作業計画と利用上限の待ち行列を読む。
 * 読み取り専用。設定したパスとファイルの生の行は返さない。エラー文に、読んだファイルの内容を含めない。
 */
export async function GET() {
  try {
    return NextResponse.json(await getMonitorService().plan())
  } catch {
    return NextResponse.json({ error: "作業と待ちを読み込めませんでした" }, { status: 500 })
  }
}
