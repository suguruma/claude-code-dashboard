import { NextRequest, NextResponse } from "next/server"
import { errorResponse, readJsonBody } from "@/lib/apiHelpers"
import { removeProject, updateProject } from "@/lib/projects"

export const dynamic = "force-dynamic"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await readJsonBody(req)
    const updates: { name?: string; path?: string } = {}
    if (typeof body.name === "string") {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: "プロジェクト名は空にできません" }, { status: 400 })
      updates.name = name
    }
    if (typeof body.path === "string") {
      const path = body.path.trim()
      if (!path) return NextResponse.json({ error: "パスは空にできません" }, { status: 400 })
      updates.path = path
    }
    const project = await updateProject(id, updates)
    return NextResponse.json(project)
  } catch (err) {
    return errorResponse(err, { fallbackMessage: "プロジェクトの更新に失敗しました" })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await removeProject(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, { fallbackMessage: "プロジェクトの削除に失敗しました" })
  }
}
