import { NextResponse } from "next/server"
import { getDesktopSessionService } from "@/lib/desktopSessionService"
import { lanAwareJson } from "@/lib/lanAccess/apiGuard"

export const dynamic = "force-dynamic"

/**
 * Claude Desktopのセッション一覧(読み取り専用)。応答は DesktopSessionListResponse の許可リスト項目だけ。
 * エラー文には、読み取ったファイルの内容を含めないよう固定の文言を返す(検討書 S4)。
 * スマホ(LAN の入り口の経由)へは、フォルダのパスを隠して返す(⑪)。
 */
export async function GET(req: Request) {
  try {
    const service = await getDesktopSessionService()
    return lanAwareJson(req, await service.list())
  } catch {
    return NextResponse.json({ error: "セッション一覧を取得できませんでした" }, { status: 500 })
  }
}
