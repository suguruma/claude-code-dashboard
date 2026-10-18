import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { disableSkill } from "@/lib/skills"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dirName: string }> }
) {
  try {
    const { dirName } = await params
    const project = await resolveRequestProject(req)
    const skill = await disableSkill(project, dirName)
    return NextResponse.json(skill)
  } catch (err) {
    return errorResponse(err)
  }
}
