import { NextResponse } from "next/server"
import { getOrgRulesService } from "@/lib/orgRulesService"

export const dynamic = "force-dynamic"

/** フォルダはサーバーが作った識別子(sha1 の先頭12桁)で指す。パスは受け取らない */
const SAFE_KEY = /^[0-9a-f]{12}$/
/** ファイル名だけを受け取る(区切り文字・親フォルダへの移動・制御文字は受け付けない) */
const SAFE_FILE = /^[^\\/:*?"<>|\x00-\x1f]{1,200}\.md$/i

/**
 * 組織のルール(⑨)の、記憶の本文(開いたときだけ)。一覧に出たフォルダの識別子と、そのフォルダの一覧に出たファイル名だけを受け付ける。
 * 形が合わなければ 400、一覧に無ければ 404。読み取り専用。
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const key = url.searchParams.get("folder") ?? ""
  const file = url.searchParams.get("file") ?? ""
  if (!SAFE_KEY.test(key) || !SAFE_FILE.test(file) || file.includes("..")) {
    return NextResponse.json({ error: "フォルダかファイル名の形式が正しくありません" }, { status: 400 })
  }
  try {
    const service = await getOrgRulesService()
    const body = await service.memoryBody(key, file)
    if (!body) return NextResponse.json({ error: "記憶のファイルが見つかりません" }, { status: 404 })
    return NextResponse.json(body)
  } catch {
    return NextResponse.json({ error: "記憶の本文を読み込めませんでした" }, { status: 500 })
  }
}
