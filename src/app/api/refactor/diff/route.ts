import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { computeRefactorDiff } from "@/lib/ruleRefactor"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const diff = await computeRefactorDiff(project)
    return NextResponse.json(diff)
  } catch (err) {
    return errorResponse(err, { fallbackStatus: 400 })
  }
}
