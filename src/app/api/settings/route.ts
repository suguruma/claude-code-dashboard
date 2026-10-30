import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { getSettings } from "@/lib/settings"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const settings = await getSettings(project)
    return NextResponse.json(settings)
  } catch (err) {
    return errorResponse(err)
  }
}
