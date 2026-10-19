import { LAN_PAGES } from "./gatewayPolicy"

/**
 * スマホ用のページ(⑪-2)の置き場所。入り口の経由の要求(印 `x-ccd-via-lan` 付き)だけを、proxy が `app/phone` の下へ振り替える。
 * URL は今の4ページのまま(ブックマークがそのまま使え、入り口の許可リストも増えない)。`/phone/...` そのものは、入り口の
 * 許可リストに無いので、スマホからは開けない。
 * ルートの layout で印を読まないのは、読むとすべてのページが動的な描き方になり、PC の画面の描き方が変わるため(ゲート1の条件4)。
 */
export const PHONE_SEGMENT = "phone"

/** 振り替え先のパス。振り替えないときは null */
export function phoneRewritePath(pathname: string, viaLan: boolean): string | null {
  if (!viaLan) return null
  if (!(LAN_PAGES as readonly string[]).includes(pathname)) return null
  return pathname === "/" ? `/${PHONE_SEGMENT}` : `/${PHONE_SEGMENT}${pathname}`
}
