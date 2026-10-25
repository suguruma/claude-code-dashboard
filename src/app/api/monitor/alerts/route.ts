import { NextResponse } from "next/server"
import { getMonitorService } from "@/lib/monitor/monitorService"

export const dynamic = "force-dynamic"

/**
 * PC の警告の要約(⑭ WC-6・WC-12)。ホームの帯・サイドバーの「！」・通知が読む。直近24時間の CPU とメモリの最後の帯だけ。
 * 読み取り専用。パスとファイルの生の行は返さない。
 */
export async function GET() {
  try {
    return NextResponse.json(await getMonitorService().alerts())
  } catch {
    return NextResponse.json({ error: "PC の警告を読み込めませんでした" }, { status: 500 })
  }
}
