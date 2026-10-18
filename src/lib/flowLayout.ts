/**
 * 組織図の線(肘型)の経路。DOMに触れず、カードの位置(矩形)から、SVGの path の `d` 属性を作る。
 * 2行目以降のカードへは、列の間と行の間を通して、カードに重ならないようにする。
 * 3層目のカードは、親のカードの下に重ねて置くので、親のカードの下から、左寄りの縦線で下ろして、カードの横から入れる。
 */

export interface Rect {
  /** チャートの左上を原点にした位置と大きさ(px) */
  left: number
  top: number
  width: number
  height: number
}

export interface WireInput {
  /** 指揮役のカード */
  leader: Rect
  /**
   * 子のカード(2層目と3層目)。parentId が members の中にいれば、その子の3層目として、親のカードから線を引く。
   * null、または members に無ければ、指揮役の子(2層目)として、指揮役から線を引く
   */
  members: Array<{ id: string; rect: Rect; parentId?: string | null }>
  /** 「他のグループ・外部」の印。無ければ null */
  external: Rect | null
  columnGap: number
  rowGap: number
}

export interface Wires {
  /** 子のID → 指揮役から子への線 */
  members: Record<string, string>
  /** 他のグループ・外部から指揮役への線。印が無ければ null */
  external: string | null
}

const n = (value: number) => Math.round(value * 10) / 10

/** 3層目への縦線を、親のカードの左端から入れる位置(px)。3層目のカードを下げる字下げより小さくする */
export const SUB_TRUNK_OFFSET = 12
/** 3層目のカードへ、横線を入れる高さ(カードの上端から。カードが低ければ、半分の高さ) */
const SUB_ENTRY_DEPTH = 22

export function wirePaths(input: WireInput): Wires {
  const { leader, members, external, columnGap, rowGap } = input
  const ox = leader.left + leader.width / 2
  const oy = leader.top + leader.height
  const result: Wires = { members: {}, external: null }

  const rects = new Map(members.map((m) => [m.id, m.rect] as const))
  const direct = members.filter((m) => !m.parentId || !rects.has(m.parentId))
  const subs = members.filter((m) => m.parentId && rects.has(m.parentId))

  if (direct.length > 0) {
    const firstTop = Math.min(...direct.map((m) => m.rect.top))
    const busY = (oy + firstTop) / 2
    for (const { id, rect } of direct) {
      const cx = rect.left + rect.width / 2
      result.members[id] =
        rect.top - firstTop < 4
          ? `M${n(ox)},${n(oy)} V${n(busY)} H${n(cx)} V${n(rect.top)}`
          : `M${n(ox)},${n(oy)} V${n(busY)} H${n(rect.left - columnGap / 2)} V${n(rect.top - rowGap / 2)} H${n(cx)} V${n(rect.top)}`
    }
  }

  for (const { id, rect, parentId } of subs) {
    const parent = rects.get(parentId as string) as Rect
    const trunkX = parent.left + Math.min(SUB_TRUNK_OFFSET, parent.width / 2)
    const entryY = rect.top + Math.min(SUB_ENTRY_DEPTH, rect.height / 2)
    result.members[id] = `M${n(trunkX)},${n(parent.top + parent.height)} V${n(entryY)} H${n(rect.left)}`
  }

  if (external) {
    // 横に並べられないほど狭いときは、「他のグループ・外部」の下から指揮役のカードの上へ縦に引く。
    // 印がカードに重なっている(線を引く隙間が無い)ときは、線は引かない
    if (external.left > leader.left + leader.width) {
      result.external = `M${n(external.left)},${n(external.top + external.height / 2)} H${n(leader.left + leader.width)}`
    } else if (external.top + external.height <= leader.top) {
      result.external = `M${n(external.left + external.width / 2)},${n(external.top + external.height)} V${n(leader.top)}`
    }
  }
  return result
}
