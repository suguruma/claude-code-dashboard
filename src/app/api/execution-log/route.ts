import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { getExecutionLogs } from "@/lib/executionLog"
import { FileIOError } from "@/lib/fileIO"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const logs = await getExecutionLogs(project)
    logs.sort((a, b) => (a.executed_at < b.executed_at ? 1 : -1))
    return NextResponse.json({ logs })
  } catch (err) {
    if (err instanceof ApiValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof FileIOError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : "予期しないエラーが発生しました"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
