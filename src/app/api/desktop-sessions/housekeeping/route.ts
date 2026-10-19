import { NextResponse } from "next/server"
import { getHousekeepingService } from "@/lib/housekeepingService"
import { lanAwareJson } from "@/lib/lanAccess/apiGuard"

export const dynamic = "force-dynamic"

/**
 * セッションの整理(⑦)の3つの一覧(コンテキスト整理の候補・返事の無い指示・判断待ち)。読み取り専用。
 * 応答は HousekeepingResponse の許可リスト項目だけ(会話の本文・報告の本文は返さない)。
 * エラー文には、読み取ったファイルの内容を含めないよう固定の文言を返す(検討書 S4)。
 */
export async function GET(req: Request) {
  try {
    const service = await getHousekeepingService()
    return lanAwareJson(req, await service.get())
  } catch {
    return NextResponse.json({ error: "セッションの整理のデータを取得できませんでした" }, { status: 500 })
  }
}
