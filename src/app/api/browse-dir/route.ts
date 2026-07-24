import { NextRequest, NextResponse } from "next/server"
import { browseDirectory, getShortcuts } from "@/lib/dirBrowser"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const targetPath = req.nextUrl.searchParams.get("path")
    const result = await browseDirectory(targetPath)
    return NextResponse.json({ ...result, shortcuts: getShortcuts() })
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    const message =
      nodeErr.code === "EACCES" || nodeErr.code === "EPERM"
        ? "このフォルダにはアクセスできません"
        : nodeErr.code === "ENOENT"
          ? "指定されたフォルダが見つかりません"
          : err instanceof Error
            ? err.message
            : "ディレクトリの読み込みに失敗しました"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
