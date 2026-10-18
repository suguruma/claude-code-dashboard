import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { listMemoryProjects } from "@/lib/memory"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const memoryProjects = await listMemoryProjects(project)
    return NextResponse.json({ memoryProjects })
  } catch (err) {
    return errorResponse(err)
  }
}
