import { NextResponse } from "next/server"
import { getFlowService, parseFlowParams } from "@/lib/flowService"
import { lanAwareJson } from "@/lib/lanAccess/apiGuard"

export const dynamic = "force-dynamic"

/**
 * グループの組織図アニメーション用の、出来事の列(読み取り専用)。応答は FlowResponse の許可リスト項目だけ。
 * `since`(ms)は出来事を返す範囲の始まりで、省略・不正(数値でない・未来・24時間より前)なら4時間前。
 * エラー文には、読み取ったファイルの内容を含めないよう固定の文言を返す(検討書 S4)。
 */
export async function GET(req: Request) {
  const { group, since } = parseFlowParams(new URL(req.url).searchParams)
  if (!group) {
    return NextResponse.json({ error: "グループIDの形式が正しくありません" }, { status: 400 })
  }
  try {
    const service = await getFlowService()
    const flow = await service.build(group, since)
    if (!flow) return NextResponse.json({ error: "グループが見つかりません" }, { status: 404 })
    return lanAwareJson(req, flow)
  } catch {
    return NextResponse.json({ error: "組織図のデータを取得できませんでした" }, { status: 500 })
  }
}
