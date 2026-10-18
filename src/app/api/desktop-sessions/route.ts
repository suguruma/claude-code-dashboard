import { NextResponse } from "next/server"
import { getDesktopSessionService } from "@/lib/desktopSessionService"

export const dynamic = "force-dynamic"

/**
 * Claude Desktopのセッション一覧(読み取り専用)。応答は DesktopSessionListResponse の許可リスト項目だけ。
 * エラー文には、読み取ったファイルの内容を含めないよう固定の文言を返す(検討書 S4)。
 */
export async function GET() {
  try {
    const service = await getDesktopSessionService()
    return NextResponse.json(await service.list())
  } catch {
    return NextResponse.json({ error: "セッション一覧を取得できませんでした" }, { status: 500 })
  }
}
