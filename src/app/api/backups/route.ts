import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { listBackups } from "@/lib/backups"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const backups = await listBackups(project)
    return NextResponse.json({ backups })
  } catch (err) {
    return errorResponse(err)
  }
}
