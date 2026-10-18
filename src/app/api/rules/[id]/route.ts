import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { deleteRule, updateRule } from "@/lib/rules"

export const dynamic = "force-dynamic"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const project = await resolveRequestProject(req)
    const body = await req.json()
    const patch: { category?: string; content?: string; enabled?: boolean } = {}
    if (typeof body.category === "string") patch.category = body.category.trim()
    if (typeof body.content === "string") patch.content = body.content.trim()
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled
    const rule = await updateRule(project, id, patch)
    return NextResponse.json(rule)
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const project = await resolveRequestProject(req)
    await deleteRule(project, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
