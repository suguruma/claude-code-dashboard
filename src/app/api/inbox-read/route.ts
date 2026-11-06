import { NextRequest, NextResponse } from "next/server"
import { errorResponse, readJsonBody } from "@/lib/apiHelpers"
import { rejectViaLan } from "@/lib/lanAccess/apiGuard"
import { getInboxReadStore } from "@/lib/inboxReadStore"

export const dynamic = "force-dynamic"

/** 知らせの既読の記録(⑮ OR-4・A8)。見た時刻・対象の ID・知らせの種類だけを返す。PC の画面からだけ */
export async function GET(req: Request) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  return NextResponse.json(await getInboxReadStore().get())
}

/** 既読にする・未読に戻す({ items: [{ target, kind }], unread?: true })。PC の画面からだけ(スマホからは 403) */
export async function POST(req: NextRequest) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  try {
    return NextResponse.json(await getInboxReadStore().update(await readJsonBody(req)))
  } catch (err) {
    return errorResponse(err)
  }
}
