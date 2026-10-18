import { NextRequest, NextResponse } from "next/server"
import { errorResponse, readJsonBody, resolveRequestProject } from "@/lib/apiHelpers"
import { reorderRules } from "@/lib/rules"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await readJsonBody(req)
    const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds : null
    if (!orderedIds || orderedIds.some((id: unknown) => typeof id !== "string")) {
      return NextResponse.json({ error: "orderedIds は文字列の配列で指定してください" }, { status: 400 })
    }
    const rules = await reorderRules(project, orderedIds)
    return NextResponse.json({ rules })
  } catch (err) {
    return errorResponse(err)
  }
}
