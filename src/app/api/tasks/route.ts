import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { listTaskSessions } from "@/lib/taskHistory"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const sessions = await listTaskSessions(project)
    return NextResponse.json({ sessions })
  } catch (err) {
    return errorResponse(err)
  }
}
