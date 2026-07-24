import { NextResponse } from "next/server"
import { FileIOError } from "@/lib/fileIO"
import { listSessions } from "@/lib/sessionMonitor"

export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dirName: string }> }
) {
  try {
    const { dirName } = await params
    const sessions = await listSessions(dirName)
    return NextResponse.json({ sessions })
  } catch (err) {
    if (err instanceof FileIOError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : "予期しないエラーが発生しました"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
