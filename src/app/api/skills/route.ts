import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { FileIOError } from "@/lib/fileIO"
import { createSkill, listSkills } from "@/lib/skills"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const skills = await listSkills(project)
    return NextResponse.json({ skills })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await req.json()
    const dirName = typeof body.dirName === "string" ? body.dirName.trim() : ""
    const description = typeof body.description === "string" ? body.description.trim() : ""
    const skillBody = typeof body.body === "string" ? body.body : ""
    const category = typeof body.category === "string" ? body.category.trim() || undefined : undefined
    if (!dirName || !description) {
      return NextResponse.json({ error: "dirName と description は必須です" }, { status: 400 })
    }
    const skill = await createSkill(project, { dirName, description, body: skillBody, category })
    return NextResponse.json(skill, { status: 201 })
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
  const status = message.includes("既に存在します") ? 409 : 500
  return NextResponse.json({ error: message }, { status })
}
