import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * exe の立ち上がりの確かめ(electron/startup.js)の入り口。データもファイルも読まずに、すぐ 200 を返す。
 * 重いトップページ(/)を確かめに使うと、遅い PC では打ち切りと描き直しを繰り返して準備が終わらないため
 */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } })
}
