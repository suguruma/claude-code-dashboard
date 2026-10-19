import { NextResponse } from "next/server"
import { getDesktopSessionService } from "@/lib/desktopSessionService"
import { lanAwareJson } from "@/lib/lanAccess/apiGuard"

export const dynamic = "force-dynamic"

/** セッションIDは一覧のキーとして引くだけで、パスには使わない。念のため形式も絞る */
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!SAFE_ID.test(id)) {
    return NextResponse.json({ error: "セッションIDの形式が正しくありません" }, { status: 400 })
  }
  try {
    const service = await getDesktopSessionService()
    const detail = await service.detail(id)
    if (!detail) return NextResponse.json({ error: "セッションが見つかりません" }, { status: 404 })
    return lanAwareJson(req, detail)
  } catch {
    return NextResponse.json({ error: "セッション詳細を取得できませんでした" }, { status: 500 })
  }
}
