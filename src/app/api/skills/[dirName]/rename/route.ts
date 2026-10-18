import { NextRequest, NextResponse } from "next/server"
import { errorResponse, readJsonBody, resolveRequestProject } from "@/lib/apiHelpers"
import { renameSkill } from "@/lib/skills"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dirName: string }> }
) {
  try {
    const { dirName } = await params
    const project = await resolveRequestProject(req)
    const body = await readJsonBody(req)
    if (typeof body.newDirName !== "string" || !body.newDirName.trim()) {
      return NextResponse.json({ error: "newDirName は文字列で指定してください" }, { status: 400 })
    }
    const skill = await renameSkill(project, dirName, body.newDirName.trim())
    return NextResponse.json(skill)
  } catch (err) {
    return errorResponse(err)
  }
}
