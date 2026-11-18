import type { EnvMapData, EnvMapNode, RouteVisit } from "./envMapTypes"

/**
 * ⑲ 地図の並べ方(cytoscape の preset に渡す位置)。DOM に触れない純粋な関数。
 * - 層は上から下の帯(04 の閲覧ページと同じ考え方)。帯の中は左から並べ、幅を超えたら折り返す
 * - 帯の名前は HTML で地図の左に重ねて描くので、左に LABEL_GUTTER の余白を取る
 * - ［今］:つながりの無い箱は帯の右端の「つながり無し n」の1つにまとめる(要件メモ 4-2)
 * - ルートの詰めた表示:通った箱だけを帯に並べ直す(行36・帯の余白8・帯の間2。通っていない帯は20px)
 */

export const BOX_H = 36
export const BAND_PAD = 8
export const BAND_GAP = 2
export const EMPTY_BAND_H = 20
export const LABEL_GUTTER = 112
export const BOX_GAP_X = 12
export const FONT_PX = 12
export const ISOLATED_PREFIX = "isolated:"

export interface LayoutBox {
  id: string
  x: number
  y: number
  w: number
  h: number
  layer: string
}

export interface LayoutBand {
  layer: string
  label: string
  y: number
  h: number
  /** 帯の箱の数(［今］はつながり無しも含めた数) */
  count: number
}

export interface MapLayout {
  boxes: LayoutBox[]
  bands: LayoutBand[]
  width: number
  height: number
  /** 「つながり無し n」の箱(id → 中の箱の id) */
  isolated: Map<string, string[]>
}

/** 箱の名前の幅の見込み(12px の字。全角は12px・半角は7px) */
export function labelWidth(label: string): number {
  let w = 0
  for (const ch of label) w += /[\u0000-ÿ]/.test(ch) ? 7 : FONT_PX
  return Math.max(72, Math.min(240, Math.ceil(w) + 20))
}

/** 箱を左から並べ、幅を超えたら折り返す。返すのは箱の位置(中心)と帯の高さ */
function flow(items: { id: string; label: string; layer: string }[], top: number, width: number): { boxes: LayoutBox[]; height: number } {
  const boxes: LayoutBox[] = []
  let x = LABEL_GUTTER
  let row = 0
  for (const it of items) {
    const w = labelWidth(it.label)
    if (x > LABEL_GUTTER && x + w > width) {
      row++
      x = LABEL_GUTTER
    }
    boxes.push({ id: it.id, x: x + w / 2, y: top + BAND_PAD / 2 + row * (BOX_H + BAND_PAD) + BOX_H / 2, w, h: BOX_H, layer: it.layer })
    x += w + BOX_GAP_X
  }
  const rows = items.length === 0 ? 0 : row + 1
  return { boxes, height: rows === 0 ? EMPTY_BAND_H : rows * (BOX_H + BAND_PAD) }
}

/** ［今］の並べ方。width は並べてよい幅(1.0倍のときの px。地図の枠の幅から余白を引いた値)。返す width は中身の幅 */
export function layoutNow(data: EnvMapData, width: number): MapLayout {
  const boxes: LayoutBox[] = []
  const bands: LayoutBand[] = []
  const isolated = new Map<string, string[]>()
  let y = 0
  for (const layer of data.layers) {
    const inLayer = data.nodes.filter((n) => n.layer === layer.id)
    const linked = inLayer.filter((n) => n.degree > 0)
    const alone = inLayer.filter((n) => n.degree === 0)
    const items: { id: string; label: string; layer: string }[] = linked.map((n) => ({ id: n.id, label: n.label, layer: n.layer }))
    if (alone.length > 0) {
      const id = `${ISOLATED_PREFIX}${layer.id}`
      isolated.set(id, alone.map((n) => n.id))
      items.push({ id, label: isolatedLabel(alone.length), layer: layer.id })
    }
    const f = flow(items, y, width)
    boxes.push(...f.boxes)
    bands.push({ layer: layer.id, label: layer.label, y, h: f.height, count: inLayer.length })
    y += f.height + BAND_GAP
  }
  return { boxes, bands, width: extent(boxes), height: Math.max(0, y - BAND_GAP), isolated }
}

/** 箱の右端(並べた中身の幅) */
function extent(boxes: LayoutBox[]): number {
  return boxes.reduce((m, b) => Math.max(m, b.x + b.w / 2), LABEL_GUTTER)
}

export const isolatedLabel = (n: number) => `つながり無し ${n}`

/** ルートの詰めた表示:通った箱だけを、帯ごとに初めて通った順で並べる */
export function layoutRoute(data: EnvMapData, visits: RouteVisit[], width: number): MapLayout {
  const byId = new Map<string, EnvMapNode>(data.nodes.map((n) => [n.id, n]))
  const boxes: LayoutBox[] = []
  const bands: LayoutBand[] = []
  let y = 0
  for (const layer of data.layers) {
    const items = visits
      .filter((v) => byId.get(v.box)?.layer === layer.id)
      .map((v) => ({ id: v.box, label: byId.get(v.box)!.label, layer: layer.id }))
    const f = flow(items, y, width)
    boxes.push(...f.boxes)
    bands.push({ layer: layer.id, label: layer.label, y, h: f.height, count: items.length })
    y += f.height + BAND_GAP
  }
  return { boxes, bands, width: extent(boxes), height: Math.max(0, y - BAND_GAP), isolated: new Map() }
}

/** 全体を表示したときの倍率(地図の枠に全部が入る倍率。最小倍率はこれより少し小さくする。固定の 0.2 にしない) */
export function fitZoom(layout: MapLayout, viewW: number, viewH: number, padding = 16): number {
  if (layout.width <= 0 || layout.height <= 0) return 1
  return Math.min(1, (viewW - padding * 2) / layout.width, (viewH - padding * 2) / layout.height)
}

/** 実効の字の大きさがこれ未満なら箱の名前を出さない(A15) */
export const MIN_EFFECTIVE_FONT = 12

/** ［順に光らせる］の1歩の間隔:全体を15秒以内、1歩は 300ms 以上 1200ms 以下(A20) */
export function playbackInterval(steps: number): number {
  if (steps <= 0) return 0
  return Math.max(300, Math.min(1200, Math.floor(15000 / steps)))
}

/** 丸囲みの番号(①〜⑳。それより大きい数は「(21)」) */
export function circled(n: number): string {
  if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1)
  return `(${n})`
}
