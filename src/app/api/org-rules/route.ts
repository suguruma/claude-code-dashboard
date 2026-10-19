import { NextResponse } from "next/server"
import { getOrgRulesService } from "@/lib/orgRulesService"

export const dynamic = "force-dynamic"

/**
 * 組織のルール(⑨)。グローバルの CLAUDE.md・指揮役の作業フォルダの CLAUDE.md と記憶の一覧・設定で足したファイル。読み取り専用。
 * 記憶の本文は返さない(開いたときに /api/org-rules/memory で返す)。エラー文には、読んだファイルの内容を含めない。
 */
export async function GET() {
  try {
    const service = await getOrgRulesService()
    return NextResponse.json(await service.get())
  } catch {
    return NextResponse.json({ error: "組織のルールを読み込めませんでした" }, { status: 500 })
  }
}
