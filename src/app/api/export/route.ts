import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { buildExportBundle } from "@/lib/exportImport"
import { FileIOError } from "@/lib/fileIO"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const bundle = await buildExportBundle(project)
    const safeName = project.name.replace(/[^a-zA-Z0-9_-]+/g, "_")
    const fileName = `claude-code-export_${safeName}_${Date.now()}.json`
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    })
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
  return NextResponse.json({ error: message }, { status: 500 })
}
