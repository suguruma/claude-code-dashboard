import { NextRequest, NextResponse } from "next/server"
import { FileIOError } from "@/lib/fileIO"
import { addProject, getProjectsFile, selectProject } from "@/lib/projects"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const data = await getProjectsFile()
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof FileIOError ? err.message : "プロジェクト一覧の取得に失敗しました"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const path = typeof body.path === "string" ? body.path.trim() : ""
    if (!name || !path) {
      return NextResponse.json({ error: "name と path は必須です" }, { status: 400 })
    }
    const project = await addProject(name, path)
    return NextResponse.json(project, { status: 201 })
  } catch (err) {
    const message = err instanceof FileIOError ? err.message : "プロジェクトの追加に失敗しました"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const id = typeof body.selectedProjectId === "string" ? body.selectedProjectId : ""
    if (!id) {
      return NextResponse.json({ error: "selectedProjectId は必須です" }, { status: 400 })
    }
    await selectProject(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "プロジェクトの切り替えに失敗しました"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
