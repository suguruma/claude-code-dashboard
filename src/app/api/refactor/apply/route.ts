import { NextRequest, NextResponse } from "next/server"
import { ApiValidationError, resolveRequestProject } from "@/lib/apiHelpers"
import { FileIOError } from "@/lib/fileIO"
import { applyRefactorProposal } from "@/lib/ruleRefactor"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const project = await resolveRequestProject(req)
    const body = await req.json()
    const selectedIndexes = Array.isArray(body.selectedIndexes)
      ? body.selectedIndexes.filter((i: unknown): i is number => typeof i === "number")
      : []
    const result = await applyRefactorProposal(project, selectedIndexes)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof ApiValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof FileIOError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : "予期しないエラーが発生しました"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
