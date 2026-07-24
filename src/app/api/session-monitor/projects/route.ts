import { NextResponse } from "next/server"
import { FileIOError } from "@/lib/fileIO"
import { listSessionProjects } from "@/lib/sessionMonitor"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const projects = await listSessionProjects()
    return NextResponse.json({ projects })
  } catch (err) {
    if (err instanceof FileIOError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : "予期しないエラーが発生しました"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
