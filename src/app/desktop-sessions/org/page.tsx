import { redirect } from "next/navigation"

/**
 * 組織図はホーム(/)に移した(⑧)。ブックマークや古いリンクが切れないよう、このページはホームへ移す。
 * 詳細を開くクエリ(?session=…)などは、そのまま引き継ぐ。
 */
export default async function OrgChartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v)
  }
  const query = params.toString()
  redirect(query ? `/?${query}` : "/")
}
