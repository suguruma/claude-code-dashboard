import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { FileIOError } from "@/lib/fileIO"
import { getSettings, updateSettings } from "@/lib/settings"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const settings = await getSettings(project)
    return NextResponse.json(settings)
  } catch (err) {
    return handleError(err)
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
