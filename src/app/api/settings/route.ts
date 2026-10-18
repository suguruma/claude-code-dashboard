import { NextRequest, NextResponse } from "next/server"
import { errorResponse, resolveRequestProject } from "@/lib/apiHelpers"
import { getSettings, updateSettings } from "@/lib/settings"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const settings = await getSettings(project)
    return NextResponse.json(settings)
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await req.json()
    if (body.raw === null || typeof body.raw !== "object" || Array.isArray(body.raw)) {
      return NextResponse.json({ error: "raw はJSONオブジェクトで指定してください" }, { status: 400 })
    }
    const settings = await updateSettings(project, body.raw)
    return NextResponse.json(settings)
  } catch (err) {
    return errorResponse(err)
  }
}
