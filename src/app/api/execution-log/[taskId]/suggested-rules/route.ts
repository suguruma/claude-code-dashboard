import { NextRequest, NextResponse } from "next/server"
import { errorResponse, readJsonBody, resolveRequestProject } from "@/lib/apiHelpers"
import { saveSuggestedRulesFromLog } from "@/lib/executionLog"
import { getProjectById } from "@/lib/projects"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    // ?projectId= はexecution_log.jsonの読み込み元（分析対象）。書き込み先が別なら
    // bodyのtargetProjectIdで指定する（未指定なら読み込み元と同じプロジェクトに保存する）
    const sourceProject = await resolveRequestProject(req)
    const body = await readJsonBody(req, { optional: true })
    const targetProjectId = typeof body.targetProjectId === "string" ? body.targetProjectId : null
    const targetProject = targetProjectId ? await getProjectById(targetProjectId) : sourceProject
    if (!targetProject) {
      return NextResponse.json({ error: "保存先のプロジェクトが見つかりません" }, { status: 400 })
    }
    const savedCount = await saveSuggestedRulesFromLog(sourceProject, targetProject, taskId)
    return NextResponse.json({ ok: true, savedCount })
  } catch (err) {
    return errorResponse(err)
  }
}
