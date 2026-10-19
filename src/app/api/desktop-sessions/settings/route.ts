import { NextRequest, NextResponse } from "next/server"
import {
  InvalidNotifySettingsError,
  getDesktopNotifySettings,
  setDesktopNotifySettings,
} from "@/lib/desktopNotifySettings"
import { lanAwareJson, rejectViaLan } from "@/lib/lanAccess/apiGuard"

export const dynamic = "force-dynamic"

/** 要対応のデスクトップ通知のオン・オフ。保存するのは真偽値1つだけ */
export async function GET(req: Request) {
  return lanAwareJson(req, await getDesktopNotifySettings())
}

/** 書き込みは PC からだけ(LAN の入り口は書き込みを中継しないが、念のため重ねる) */
export async function POST(req: NextRequest) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSONの形式が正しくありません" }, { status: 400 })
  }
  try {
    return NextResponse.json(await setDesktopNotifySettings(body))
  } catch (err) {
    if (err instanceof InvalidNotifySettingsError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return NextResponse.json({ error: "設定を保存できませんでした" }, { status: 500 })
  }
}
