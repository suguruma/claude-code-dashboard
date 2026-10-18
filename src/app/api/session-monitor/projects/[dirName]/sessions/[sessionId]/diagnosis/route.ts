import { NextResponse } from "next/server"
import { errorResponse } from "@/lib/apiHelpers"
import { getSessionMetrics } from "@/lib/sessionMonitor"
import { readSessionSemanticDiagnosis } from "@/lib/sessionSemanticDiagnosis"

export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dirName: string; sessionId: string }> }
) {
  try {
    const { dirName, sessionId } = await params
    const metrics = await getSessionMetrics(dirName, sessionId)
    const diagnosis = await readSessionSemanticDiagnosis(metrics.summary.cwd, sessionId)
    return NextResponse.json({ diagnosis })
  } catch (err) {
    return errorResponse(err)
  }
}
