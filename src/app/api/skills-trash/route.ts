import { NextRequest, NextResponse } from "next/server"
import { errorResponse, readJsonBody, resolveRequestProject } from "@/lib/apiHelpers"
import { listTrashedSkills, restoreTrashedSkill, skillTrashDir } from "@/lib/skillTrash"

export const dynamic = "force-dynamic"

/** 削除済みスキルの一覧と、退避先フォルダ。退避先は `skills/` の外にある(Claude Codeからは呼び出せない) */
export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const items = await listTrashedSkills(project)
    return NextResponse.json({ items, trashPath: skillTrashDir(project) })
  } catch (err) {
    return errorResponse(err)
  }
}

/** 削除済みスキルを元の場所へ戻す。body: { id } */
export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await readJsonBody(req)
    if (typeof body.id !== "string" || !body.id.trim()) {
      return NextResponse.json({ error: "id は文字列で指定してください" }, { status: 400 })
    }
    const restored = await restoreTrashedSkill(project, body.id)
    return NextResponse.json(restored)
  } catch (err) {
    return errorResponse(err)
  }
}
