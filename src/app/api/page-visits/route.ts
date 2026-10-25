import { NextRequest, NextResponse } from "next/server"
import { errorResponse, readJsonBody } from "@/lib/apiHelpers"
import { lanAwareJson, rejectViaLan } from "@/lib/lanAccess/apiGuard"
import { getPageVisitStore } from "@/lib/pageVisitStore"

export const dynamic = "force-dynamic"

/** ページを開いた回数(⑬ FS-7)。13ページのパスと日付ごとの回数、数えるかどうかだけを返す */
export async function GET(req: Request) {
  return lanAwareJson(req, await getPageVisitStore().get())
}

/** 画面から届いた「開いた」を数える(PC の画面からだけ。オフのあいだは数えない) */
export async function POST(req: NextRequest) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  try {
    return NextResponse.json({ accepted: await getPageVisitStore().record(await readJsonBody(req)) })
  } catch (err) {
    return errorResponse(err)
  }
}

/** 数える・数えないの切り替え(PC の画面からだけ) */
export async function PUT(req: NextRequest) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  try {
    return NextResponse.json(await getPageVisitStore().setEnabled(await readJsonBody(req)))
  } catch (err) {
    return errorResponse(err)
  }
}
