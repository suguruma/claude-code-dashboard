import { NextResponse } from "next/server"
import { FileIOError } from "@/lib/fileIO"
import { getSessionMetrics } from "@/lib/sessionMonitor"

export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dirName: string; sessionId: string }> }
) {
  try {
    const { dirName, sessionId } = await params
    const metrics = await getSessionMetrics(dirName, sessionId)
    return NextResponse.json({ metrics })
  } catch (err) {
    if (err instanceof FileIOError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : "予期しないエラーが発生しました"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
