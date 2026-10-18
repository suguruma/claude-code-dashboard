import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { getMemoryEntries } from "@/lib/memory"

export const dynamic = "force-dynamic"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dirName: string }> }
) {
  try {
    const { dirName } = await params
    const project = await resolveRequestProject(req)
    const entries = await getMemoryEntries(project, dirName)
    return NextResponse.json({ entries })
  } catch (err) {
    return errorResponse(err)
  }
}
