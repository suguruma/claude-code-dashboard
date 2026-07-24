import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { computeImportDiff, validateBundle } from "@/lib/exportImport"
import { FileIOError } from "@/lib/fileIO"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await req.json()
    const bundle = validateBundle(body.bundle)
    const diff = await computeImportDiff(project, bundle)
    return NextResponse.json(diff)
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
