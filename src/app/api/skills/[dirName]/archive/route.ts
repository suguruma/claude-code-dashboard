import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { archiveCurrentVersion, listArchivedVersions } from "@/lib/skillArchive"

export const dynamic = "force-dynamic"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dirName: string }> }
) {
  try {
    const { dirName } = await params
    const project = await resolveRequestProject(req)
    const versions = await listArchivedVersions(project, dirName)
    return NextResponse.json({ versions })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dirName: string }> }
) {
  try {
    const { dirName } = await params
    const project = await resolveRequestProject(req)
    const version = await archiveCurrentVersion(project, dirName)
    return NextResponse.json(version)
  } catch (err) {
    return errorResponse(err)
  }
}
