import { NextResponse } from "next/server"
import { getRelationsService } from "@/lib/relationsService"

export const dynamic = "force-dynamic"

/**
 * 関係性マップ(⑬ 組織のページの「つながり」)。グループの組織・効いている決まり・記憶・スキル・指示ファイル・グループをまたぐ頼み。
 * 読み取り専用。ファイルの本文・パス・メッセージの本文は返さない。エラー文には、読んだファイルの内容を含めない。
 */
export async function GET() {
  try {
    const service = await getRelationsService()
    return NextResponse.json(await service.get())
  } catch {
    return NextResponse.json({ error: "関係性マップを読み込めませんでした" }, { status: 500 })
  }
}
