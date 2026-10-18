import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { applyRefactorProposal } from "@/lib/ruleRefactor"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await req.json()
    const selectedIndexes = Array.isArray(body.selectedIndexes)
      ? body.selectedIndexes.filter((i: unknown): i is number => typeof i === "number")
      : []
    const result = await applyRefactorProposal(project, selectedIndexes)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err, { fallbackStatus: 400 })
  }
}
