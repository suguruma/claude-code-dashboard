import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { createSkill, listSkills } from "@/lib/skills"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const skills = await listSkills(project)
    return NextResponse.json({ skills })
  } catch (err) {
    return errorResponse(err)
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
    const title = typeof body.title === "string" ? body.title.trim() || undefined : undefined
    const targetModel =
      typeof body.targetModel === "string" ? body.targetModel.trim() || undefined : undefined
    if (!dirName || !description) {
      return NextResponse.json({ error: "dirName と description は必須です" }, { status: 400 })
    }
    const skill = await createSkill(project, {
      dirName,
      description,
      body: skillBody,
      category,
      title,
      targetModel,
    })
    return NextResponse.json(skill, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
