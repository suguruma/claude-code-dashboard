import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { readExecutionLogs } from "@/lib/executionLog"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const { logs, skipped } = await readExecutionLogs(project)
    logs.sort((a, b) => (a.executed_at < b.executed_at ? 1 : -1))
    return NextResponse.json({ logs, skipped })
  } catch (err) {
    return errorResponse(err)
  }
}
