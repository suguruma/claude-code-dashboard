import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { FileIOError } from "@/lib/fileIO"
import { listTrashedSkills, restoreTrashedSkill, skillTrashDir } from "@/lib/skillTrash"

export const dynamic = "force-dynamic"

/** 削除済みスキルの一覧と、退避先フォルダ。退避先は `skills/` の外にある(Claude Codeからは呼び出せない) */
export async function GET(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const items = await listTrashedSkills(project)
    return NextResponse.json({ items, trashPath: skillTrashDir(project) })
  } catch (err) {
    return handleError(err)
  }
}

/** 削除済みスキルを元の場所へ戻す。body: { id } */
export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await req.json()
    if (typeof body.id !== "string" || !body.id.trim()) {
      return NextResponse.json({ error: "id は文字列で指定してください" }, { status: 400 })
    }
    const restored = await restoreTrashedSkill(project, body.id)
    return NextResponse.json(restored)
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
  let status = 500
  if (message.includes("不正な")) status = 400
  else if (message.includes("見つかりません")) status = 404
  else if (message.includes("既に存在")) status = 409
  return NextResponse.json({ error: message }, { status })
}
