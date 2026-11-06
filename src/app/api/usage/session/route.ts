import { NextResponse } from "next/server"
import { lanAwareJson } from "@/lib/lanAccess/apiGuard"
import { getUsageService } from "@/lib/usageService"

export const dynamic = "force-dynamic"

/** 会話ログの ID の形。台帳の行を引くキーに使うだけで、パスには使わない */
const SESSION_KEY = /^[A-Za-z0-9-]{8,64}$/

/**
 * セッション1件の直近7日のモデル別の内訳とサブエージェントの本数(⑯ AG-5。セッションの詳細の1行)。
 * 返すのは系統の名前・数だけ(本文・パス・サブエージェントの description は無い)
 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? ""
  if (!SESSION_KEY.test(key)) return NextResponse.json({ error: "会話ログの ID の形式が正しくありません" }, { status: 400 })
  try {
    const service = await getUsageService()
    return lanAwareJson(req, await service.sessionBreakdown(key))
  } catch {
    return NextResponse.json({ error: "モデル別の内訳を取得できませんでした" }, { status: 500 })
  }
}
