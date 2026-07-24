import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { FileIOError } from "@/lib/fileIO"
import { renameSkill } from "@/lib/skills"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dirName: string }> }
) {
  try {
    const { dirName } = await params
    const project = await resolveRequestProject(req)
    const body = await req.json()
    if (typeof body.newDirName !== "string" || !body.newDirName.trim()) {
      return NextResponse.json({ error: "newDirName は文字列で指定してください" }, { status: 400 })
    }
    const skill = await renameSkill(project, dirName, body.newDirName.trim())
    return NextResponse.json(skill)
  } catch (err) {
    if (err instanceof ApiValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof FileIOError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : "予期しないエラーが発生しました"
    const status = message === "スキルが見つかりません" ? 404 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
