import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { listBlockedPlugins } from "@/lib/plugins"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const blockedPlugins = await listBlockedPlugins(project)
    return NextResponse.json({ blockedPlugins })
  } catch (err) {
    return errorResponse(err)
  }
}
