import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { restoreBackup } from "@/lib/backups"
import { FileIOError } from "@/lib/fileIO"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await req.json()
    if (typeof body.fileName !== "string" || !body.fileName.trim()) {
      return NextResponse.json({ error: "fileName は文字列で指定してください" }, { status: 400 })
    }
    if (body.kind !== undefined && body.kind !== "claude-json" && body.kind !== "ccd") {
      return NextResponse.json({ error: "kind は claude-json または ccd で指定してください" }, { status: 400 })
    }
    await restoreBackup(project, body.fileName, body.kind)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ApiValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof FileIOError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : "予期しないエラーが発生しました"
    const status = message.includes("見つかりません") || message.includes("不正な") ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
