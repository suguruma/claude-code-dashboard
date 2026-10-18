import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { createRule, getRules } from "@/lib/rules"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const rules = await getRules(project)
    return NextResponse.json({ rules })
  } catch (err) {
    return errorResponse(err)
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
    return errorResponse(err)
  }
}
