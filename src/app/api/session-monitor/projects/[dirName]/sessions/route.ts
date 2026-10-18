import { NextResponse } from "next/server"
import { errorResponse } from "@/lib/apiHelpers"
import { listSessions } from "@/lib/sessionMonitor"

export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dirName: string }> }
) {
  try {
    const { dirName } = await params
    const sessions = await listSessions(dirName)
    return NextResponse.json({ sessions })
  } catch (err) {
    return errorResponse(err)
  }
}
