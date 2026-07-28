import { NextResponse } from "next/server"
import { FileIOError } from "@/lib/fileIO"
import { getSessionMetrics } from "@/lib/sessionMonitor"

export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ dirName: string; sessionId: string }> }
) {
  try {
    const { dirName, sessionId } = await params
    const metrics = await getSessionMetrics(dirName, sessionId)
    // 詳細データ（トークン推移・ツール別集計等）は「詳細データ」を開いたときだけ要求される。
    // 既定では診断（sessionDiagnostics.ts）が実際に必要とする summary と mcpCallCountsByServer だけを返す。
    const wantsDetail = new URL(req.url).searchParams.get("detail") === "1"
    if (!wantsDetail) {
      const { summary, mcpCallCountsByServer } = metrics
      return NextResponse.json({ metrics: { summary, mcpCallCountsByServer } })
    }
    return NextResponse.json({ metrics })
  } catch (err) {
    if (err instanceof FileIOError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : "予期しないエラーが発生しました"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
