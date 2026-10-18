import { NextRequest, NextResponse } from "next/server"
import { errorResponse, readJsonBody, resolveRequestProject } from "@/lib/apiHelpers"
import { deleteSkill, updateSkill } from "@/lib/skills"

export const dynamic = "force-dynamic"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ dirName: string }> }
) {
  try {
    const { dirName } = await params
    const project = await resolveRequestProject(req)
    const body = await readJsonBody(req)
    const patch: {
      description?: string
      body?: string
      category?: string
      title?: string
      targetModel?: string
    } = {}
    if (typeof body.description === "string") patch.description = body.description.trim()
    if (typeof body.body === "string") patch.body = body.body
    if (typeof body.category === "string") patch.category = body.category.trim()
    if (typeof body.title === "string") patch.title = body.title.trim()
    if (typeof body.targetModel === "string") patch.targetModel = body.targetModel.trim()
    const skill = await updateSkill(project, dirName, patch)
    return NextResponse.json(skill)
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ dirName: string }> }
) {
  try {
    const { dirName } = await params
    const project = await resolveRequestProject(req)
    await deleteSkill(project, dirName)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
