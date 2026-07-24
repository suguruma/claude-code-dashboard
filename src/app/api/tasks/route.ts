import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { FileIOError } from "@/lib/fileIO"
import { listTaskSessions } from "@/lib/taskHistory"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const sessions = await listTaskSessions(project)
    return NextResponse.json({ sessions })
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
