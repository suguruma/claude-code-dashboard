import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { deleteExecutionLog } from "@/lib/executionLog"

export const dynamic = "force-dynamic"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    const project = await resolveRequestProject(req)
    await deleteExecutionLog(project, taskId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
