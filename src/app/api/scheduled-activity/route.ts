import { NextResponse } from "next/server"
import { rejectViaLan } from "@/lib/lanAccess/apiGuard"
import { getScheduledActivityService } from "@/lib/scheduledActivityService"

export const dynamic = "force-dynamic"

/**
 * 予定タスクのタブ(⑯): 予定タスクの回ごとの状態の印・使用量・モデルの系統・サブエージェントの本数と種類を返す。
 * PC の画面だけ(LAN の入り口を通った要求は 403。AG-7)。返す項目は ScheduledActivityResponse の許可リストだけ
 */
export async function GET(req: Request) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  try {
    const service = await getScheduledActivityService()
    return NextResponse.json(await service.get())
  } catch {
    // 内部のエラー文には会話ログのパス等が含まれうるため、固定の文言だけを返す
    return NextResponse.json({ error: "予定タスクの集計に失敗しました" }, { status: 500 })
  }
}
