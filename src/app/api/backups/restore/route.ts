import { NextRequest, NextResponse } from "next/server"
import { errorResponse, readJsonBody, resolveRequestProject } from "@/lib/apiHelpers"
import { restoreBackup } from "@/lib/backups"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await readJsonBody(req)
    if (typeof body.fileName !== "string" || !body.fileName.trim()) {
      return NextResponse.json({ error: "fileName は文字列で指定してください" }, { status: 400 })
    }
    if (body.kind !== undefined && body.kind !== "claude-json" && body.kind !== "ccd") {
      return NextResponse.json({ error: "kind は claude-json または ccd で指定してください" }, { status: 400 })
    }
    if (body.location !== undefined && typeof body.location !== "string") {
      return NextResponse.json({ error: "location は文字列で指定してください" }, { status: 400 })
    }
    await restoreBackup(project, body.fileName, body.kind, body.location)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
