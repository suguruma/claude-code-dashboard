import { NextResponse } from "next/server"
import { removeProject } from "@/lib/projects"

export const dynamic = "force-dynamic"

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await removeProject(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "プロジェクトの削除に失敗しました"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
