import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { buildExportBundle } from "@/lib/exportImport"

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
    return errorResponse(err)
  }
}
