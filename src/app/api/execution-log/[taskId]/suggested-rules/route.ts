import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { saveSuggestedRulesFromLog } from "@/lib/executionLog"
import { FileIOError } from "@/lib/fileIO"
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
    const body = await req.json().catch(() => ({}))
    const targetProjectId = typeof body.targetProjectId === "string" ? body.targetProjectId : null
    const targetProject = targetProjectId ? await getProjectById(targetProjectId) : sourceProject
    if (!targetProject) {
      return NextResponse.json({ error: "保存先のプロジェクトが見つかりません" }, { status: 400 })
    }
    const savedCount = await saveSuggestedRulesFromLog(sourceProject, targetProject, taskId)
    return NextResponse.json({ ok: true, savedCount })
  } catch (err) {
    if (err instanceof ApiValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof FileIOError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : "予期しないエラーが発生しました"
    const status = message === "指定されたタスクログが見つかりません" ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
