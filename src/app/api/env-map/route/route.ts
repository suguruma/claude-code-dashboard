import { NextResponse } from "next/server"
import { rejectViaLan } from "@/lib/lanAccess/apiGuard"
import { getEnvMapService } from "@/lib/envMap/envMapService"

export const dynamic = "force-dynamic"

const SESSION_ID = /^(?:local_[A-Za-z0-9_-]{1,100}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/

/**
 * 全体マップ(⑲)のルート:選んだ1セッションの指示ごとの箱の並び(?session=<Desktop のセッション識別子>)。
 * 返すのは箱の id・道具の名前・順番・時刻・回数だけ(EM-6)。PC の画面だけ(LAN は 403。EM-7)
 */
export async function GET(req: Request) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  const session = new URL(req.url).searchParams.get("session") ?? ""
  if (!SESSION_ID.test(session)) return NextResponse.json({ error: "セッションの指定が正しくありません" }, { status: 400 })
  try {
    const route = await getEnvMapService().route(session)
    if (!route) return NextResponse.json({ error: "このセッションは直近30日の一覧にありません" }, { status: 404 })
    return NextResponse.json(route)
  } catch {
    return NextResponse.json({ error: "ルートを読み込めませんでした" }, { status: 500 })
  }
}
