import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { saveSuggestedRulesFromLog } from "@/lib/executionLog"
import { FileIOError } from "@/lib/fileIO"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    const project = await resolveRequestProject(req)
    const savedCount = await saveSuggestedRulesFromLog(project, taskId)
    return NextResponse.json({ ok: true, savedCount })
  } catch (err) {
    if (err instanceof ApiValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof FileIOError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : "予期しないエラーが発生しました"
    const status = message === "指定されたタスクログが見つかりません" ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
