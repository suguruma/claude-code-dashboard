import { NextResponse } from "next/server"
import { errorResponse, readJsonBody } from "@/lib/apiHelpers"
import { InvalidInputError } from "@/lib/errors"
import { rejectViaLan } from "@/lib/lanAccess/apiGuard"
import { getLanOverview, setLanEnabled } from "@/lib/lanAccess/service"

export const dynamic = "force-dynamic"

/**
 * スマホから読み取り専用で見る(⑪)の状態と、オン・オフ。PC の画面(ループバック)からだけ使える。
 * 応答に、鍵のハッシュ・登録コードの平文は含めない。
 */
export async function GET(req: Request) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  try {
    return NextResponse.json(await getLanOverview(Date.now()))
  } catch {
    return NextResponse.json({ error: "スマホから見る設定を読めませんでした" }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  try {
    const body = await readJsonBody(req)
    if (typeof body.enabled !== "boolean") throw new InvalidInputError("enabled は true か false で指定してください")
    await setLanEnabled(body.enabled)
    return NextResponse.json(await getLanOverview(Date.now()))
  } catch (err) {
    return errorResponse(err, { fallbackMessage: "スマホから見る設定を保存できませんでした" })
  }
}
