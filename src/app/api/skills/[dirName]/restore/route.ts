import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { FileIOError } from "@/lib/fileIO"
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
    await restoreArchivedVersion(project, dirName, body.model)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ApiValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof FileIOError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : "予期しないエラーが発生しました"
    const status = message.includes("見つかりません") ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
