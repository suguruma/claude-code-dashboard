import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { FileIOError } from "@/lib/fileIO"
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
    return handleError(err)
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
  const status = message === "ルールが見つかりません" ? 404 : 500
  return NextResponse.json({ error: message }, { status })
}
