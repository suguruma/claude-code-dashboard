import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { FileIOError } from "@/lib/fileIO"
import { createRule, getRules } from "@/lib/rules"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const rulesFile = await getRules(project)
    return NextResponse.json(rulesFile)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await req.json()
    const category = typeof body.category === "string" ? body.category.trim() : ""
    const content = typeof body.content === "string" ? body.content.trim() : ""
    if (!category || !content) {
      return NextResponse.json({ error: "category と content は必須です" }, { status: 400 })
    }
    const rule = await createRule(project, {
      category,
      content,
      enabled: body.enabled ?? true,
    })
    return NextResponse.json(rule, { status: 201 })
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
  return NextResponse.json({ error: message }, { status: 500 })
}
