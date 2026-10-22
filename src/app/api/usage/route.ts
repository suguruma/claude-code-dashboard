import { NextResponse } from "next/server"
import { getUsageService } from "@/lib/usageService"
import { lanAwareJson } from "@/lib/lanAccess/apiGuard"

export const dynamic = "force-dynamic"

/**
 * 利用上限の可視化: 公式値(記録の読み取りのみ)と、会話記録から推定した値・ペース・セッション別の消費を返す。
 * 返す項目は UsageResponse の許可リストだけで、公式値の記録の recordedBy(記録したセッション名)は含まれない。
 * `?phase=official` は、公式値の記録だけを読んだ軽い答え(推定はまだ空。ホームが先に出すため。⑫ ST-7)
 */
export async function GET(req: Request) {
  try {
    const service = await getUsageService()
    const official = new URL(req.url).searchParams.get("phase") === "official"
    return lanAwareJson(req, official ? await service.getOfficial() : await service.get())
  } catch {
    // 内部のエラー文には会話ログのパス等が含まれうるため、固定の文言だけを返す
    return NextResponse.json({ error: "利用上限の集計に失敗しました" }, { status: 500 })
  }
}
