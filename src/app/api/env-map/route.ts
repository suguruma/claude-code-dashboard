import { NextResponse } from "next/server"
import { rejectViaLan } from "@/lib/lanAccess/apiGuard"
import { getEnvMapService } from "@/lib/envMap/envMapService"

export const dynamic = "force-dynamic"

/**
 * 全体マップ(⑲):地図(map.json を検査して画面に要る項目だけ)と、直近30日に動いたセッションの一覧。
 * PC の画面だけ(LAN の入り口を通った要求は 403。EM-7)。読むだけ。外部と通信しない
 */
export async function GET(req: Request) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  try {
    return NextResponse.json(await getEnvMapService().get())
  } catch {
    // 内部のエラー文には読んだファイルの一部が入りうるため、固定の文言だけを返す
    return NextResponse.json({ error: "全体マップを読み込めませんでした" }, { status: 500 })
  }
}
