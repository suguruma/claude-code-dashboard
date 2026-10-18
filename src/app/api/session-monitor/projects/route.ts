import { NextResponse } from "next/server"
import { errorResponse } from "@/lib/apiHelpers"
import { listSessionProjects } from "@/lib/sessionMonitor"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const projects = await listSessionProjects()
    return NextResponse.json({ projects })
  } catch (err) {
    return errorResponse(err)
  }
}
