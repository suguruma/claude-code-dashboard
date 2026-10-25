/**
 * 組織図の子のカードの並び順。DOMに触れない純粋な関数。
 *
 * - name: 名前の自然順。数字の並びは数として比べる(`2_` は `10_` より先。`01_` `02_` `03_` の順になる)。
 *   大文字・小文字・全角と半角の数字の違いは区別しない。名前が同じなら、元の順(作成順)のまま。
 * - created: 作成日時の古い順。サーバーが返す順のまま(並べ替えない)。
 */

export type MemberOrder = "name" | "created"

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" })

/**
 * 並べ替えた新しい配列を返す(元の配列は変えない)。`items` は作成順で渡す。
 * 名前が同じものは、渡された順(作成順)のまま。
 */
export function orderMembers<T>(items: readonly T[], order: MemberOrder, nameOf: (item: T) => string): T[] {
  if (order === "created") return [...items]
  return [...items].sort((a, b) => collator.compare(nameOf(a), nameOf(b)))
}
