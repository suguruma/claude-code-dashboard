import { NextRequest, NextResponse } from "next/server"
import { errorResponse, readJsonBody, resolveRequestProject } from "@/lib/apiHelpers"
import { applyImport, validateBundle } from "@/lib/exportImport"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await readJsonBody(req)
    const bundle = validateBundle(body.bundle)
    const ruleCategories = Array.isArray(body.ruleCategories)
      ? body.ruleCategories.filter((c: unknown): c is string => typeof c === "string")
      : []
    const skillDirNames = Array.isArray(body.skillDirNames)
      ? body.skillDirNames.filter((c: unknown): c is string => typeof c === "string")
      : []
    const result = await applyImport(project, bundle, { ruleCategories, skillDirNames })
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
