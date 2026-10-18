import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { restoreArchivedVersion } from "@/lib/skillArchive"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dirName: string }> }
) {
  try {
    const { dirName } = await params
    const project = await resolveRequestProject(req)
    const body = await req.json()
    if (typeof body.model !== "string") {
      return NextResponse.json({ error: "model は文字列で指定してください" }, { status: 400 })
    }
    if (body.switchBackupAt !== undefined && !Number.isInteger(body.switchBackupAt)) {
      return NextResponse.json({ error: "switchBackupAt は整数で指定してください" }, { status: 400 })
    }
    await restoreArchivedVersion(project, dirName, body.model, body.switchBackupAt)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
