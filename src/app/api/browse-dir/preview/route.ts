import { NextRequest, NextResponse } from "next/server"
import { readFilePreview } from "@/lib/dirBrowser"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const targetPath = req.nextUrl.searchParams.get("path")
    if (!targetPath) {
      return NextResponse.json({ error: "pathパラメータが必要です" }, { status: 400 })
    }
    const result = await readFilePreview(targetPath)
    return NextResponse.json(result)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    const message =
      nodeErr.code === "EACCES" || nodeErr.code === "EPERM"
        ? "このファイルにはアクセスできません"
        : nodeErr.code === "ENOENT"
          ? "指定されたファイルが見つかりません"
          : err instanceof Error
            ? err.message
            : "ファイルの読み込みに失敗しました"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
