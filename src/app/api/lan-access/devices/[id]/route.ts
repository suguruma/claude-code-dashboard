import { NextResponse } from "next/server"
import { errorResponse, readJsonBody } from "@/lib/apiHelpers"
import { InvalidInputError } from "@/lib/errors"
import { rejectViaLan } from "@/lib/lanAccess/apiGuard"
import { renameLanDevice, revokeLanDevice } from "@/lib/lanAccess/service"

export const dynamic = "force-dynamic"

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/

/** 端末の名前を変える。PC の画面(ループバック)からだけ */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  const { id } = await params
  if (!SAFE_ID.test(id)) return NextResponse.json({ error: "端末のIDの形式が正しくありません" }, { status: 400 })
  try {
    const body = await readJsonBody(req)
    if (typeof body.name !== "string" || !body.name.trim()) throw new InvalidInputError("名前を入れてください")
    const ok = await renameLanDevice(id, body.name)
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "端末が見つかりません" }, { status: 404 })
  } catch (err) {
    return errorResponse(err, { fallbackMessage: "名前を変えられませんでした" })
  }
}

/** 端末を取り消す(次の要求から断る)。PC の画面(ループバック)からだけ */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = rejectViaLan(req)
  if (denied) return denied
  const { id } = await params
  if (!SAFE_ID.test(id)) return NextResponse.json({ error: "端末のIDの形式が正しくありません" }, { status: 400 })
  const ok = await revokeLanDevice(id)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "端末が見つかりません" }, { status: 404 })
}
