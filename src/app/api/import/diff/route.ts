import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { computeImportDiff, validateBundle } from "@/lib/exportImport"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await req.json()
    const bundle = validateBundle(body.bundle)
    const diff = await computeImportDiff(project, bundle)
    return NextResponse.json(diff)
  } catch (err) {
    return errorResponse(err, { fallbackStatus: 400 })
  }
}
