/**
 * 組織図の粒(SVG の円)と、線の横のラベル(div)の、属性・スタイルを決める部分。DOM にも React にも触れない純粋な関数と、
 * 決めた仕様を要素に当てはめるだけの applySpec だけを置く（OrgChartCanvas の spawn・confirmReceipt が使う）。
 * 仕様を関数に分けてあるのは、粒の種類・色・送信側のみ(破線)/確認済み(実線)の見た目を、ブラウザなしで単体テストするため。
 */

/** 粒の向き: 下向き=指示、上向き=報告、cross=他グループ・外部からの連絡 */
export type FlowDir = "down" | "up" | "cross"

export const DIR_COLOR: Record<FlowDir, string> = { down: "var(--flow-down)", up: "var(--flow-up)", cross: "var(--flow-cross)" }

/** 粒とラベルの `data-kind`(確認用の属性) */
export const KIND_OF_DIR: Record<FlowDir, "instruct" | "report" | "cross"> = { down: "instruct", up: "report", cross: "cross" }

/** 確認用の属性 `data-testid` の値 */
export const LABEL_TESTID = "org-line-label"
export const PARTICLE_TESTID = "org-particle"

/** 受信を確認できていない(送信側のみ)ことを示す `data-receipt` の値 */
export const SENDER_ONLY = "sender-only"

const LABEL_CLASS =
  "pointer-events-none absolute z-[3] whitespace-nowrap rounded-md border bg-card px-1.5 py-0.5 text-[11px] text-foreground shadow-sm"
const PARTICLE_CLASS = "org-particle"

/**
 * 要素に当てはめる仕様。
 * - attrs: setAttribute で付ける属性
 * - data: dataset(キャメルケースのキー)。null は、その data 属性を取り除く
 * - style: インラインスタイル(キャメルケースのプロパティ名)。空文字は、そのスタイルを外す
 * - text: textContent
 */
export interface DomSpec {
  attrs: Record<string, string>
  data: Record<string, string | null>
  style: Record<string, string>
  text?: string
}

/** 線の横のラベル。送信側のみ(受信を確認できていない指示)は、枠を破線にして、印(data-receipt)を付ける */
export function lineLabelSpec(o: { dir: FlowDir; pathKey: string; senderOnly: boolean; text: string }): DomSpec {
  return {
    attrs: { class: LABEL_CLASS },
    data: {
      testid: LABEL_TESTID,
      kind: KIND_OF_DIR[o.dir],
      pathKey: o.pathKey,
      ...(o.senderOnly ? { receipt: SENDER_ONLY } : {}),
    },
    style: { borderColor: DIR_COLOR[o.dir], ...(o.senderOnly ? { borderStyle: "dashed" } : {}) },
    text: o.text,
  }
}

/**
 * 粒(円)。確認済みは色で塗りつぶす。送信側のみは、中を白(カードの色)にして、色の破線の枠にする。
 * 文字色(color)は、向きの色にそろえる（粒の周りの影などが currentColor を使うため）。
 */
export function particleSpec(o: { dir: FlowDir; pathKey: string; radius: number; senderOnly: boolean }): DomSpec {
  const color = DIR_COLOR[o.dir]
  return {
    attrs: { r: o.radius.toFixed(1), class: PARTICLE_CLASS },
    data: {
      testid: PARTICLE_TESTID,
      kind: KIND_OF_DIR[o.dir],
      pathKey: o.pathKey,
      ...(o.senderOnly ? { receipt: SENDER_ONLY } : {}),
    },
    style: o.senderOnly
      ? { fill: "var(--card)", stroke: color, strokeWidth: "2", strokeDasharray: "2 2", color }
      : { fill: color, color },
  }
}

/**
 * 「受信未確認」だったラベル・粒が、確認済みになったときの切り替え（印を外し、実線・塗りつぶしの見た目にする）。
 * ラベルは本文の要約に差し替える（要約が空なら「指示」）。粒はもう一度流さず、見た目だけを切り替える。
 */
export function receiptConfirmedSpec(testid: string | undefined, summary: string): DomSpec {
  if (testid === LABEL_TESTID) {
    return { attrs: {}, data: { receipt: null }, style: { borderStyle: "solid" }, text: summary || "指示" }
  }
  return {
    attrs: {},
    data: { receipt: null },
    style: { fill: DIR_COLOR.down, stroke: "", strokeWidth: "", strokeDasharray: "" },
  }
}

/** 仕様を当てはめる先（HTMLElement・SVGElement の、使う部分だけ） */
export interface SpecTarget {
  setAttribute(name: string, value: string): void
  dataset: DOMStringMap
  style: object
  textContent: string | null
}

/** 決めた仕様を要素に当てはめる。判断はしない */
export function applySpec(el: SpecTarget, spec: DomSpec): void {
  for (const [name, value] of Object.entries(spec.attrs)) el.setAttribute(name, value)
  for (const [key, value] of Object.entries(spec.data)) {
    if (value === null) delete el.dataset[key]
    else el.dataset[key] = value
  }
  Object.assign(el.style, spec.style)
  if (spec.text !== undefined) el.textContent = spec.text
}
