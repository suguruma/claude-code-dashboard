import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { applyImport, validateBundle } from "@/lib/exportImport"
import { FileIOError } from "@/lib/fileIO"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await req.json()
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
    return handleError(err)
  }
}

function handleError(err: unknown) {
  if (err instanceof ApiValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
  if (err instanceof FileIOError) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
  const message = err instanceof Error ? err.message : "予期しないエラーが発生しました"
  return NextResponse.json({ error: message }, { status: 400 })
}
