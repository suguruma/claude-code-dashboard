import { describe, expect, it } from "vitest"
import {
  DIR_COLOR,
  KIND_OF_DIR,
  LABEL_TESTID,
  PARTICLE_TESTID,
  SENDER_ONLY,
  applySpec,
  lineLabelSpec,
  particleSpec,
  receiptConfirmedSpec,
  type FlowDir,
  type SpecTarget,
} from "./flowParticleSpec"

const DIRS: FlowDir[] = ["down", "up", "cross"]

/** DOM の代わりに、当てはめられた内容を記録するだけの要素 */
function fakeElement(initial: Partial<{ dataset: Record<string, string>; style: Record<string, string>; text: string }> = {}) {
  const attrs: Record<string, string> = {}
  const el = {
    setAttribute: (name: string, value: string) => {
      attrs[name] = value
    },
    dataset: { ...(initial.dataset ?? {}) } as Record<string, string | undefined>,
    style: { ...(initial.style ?? {}) } as Record<string, string>,
    textContent: initial.text ?? (null as string | null),
  }
  return { el: el as unknown as SpecTarget, attrs, dataset: el.dataset, style: el.style, get text() { return el.textContent } }
}

/** 空文字のスタイル(=外した)を無いものとして比べる */
const effective = (style: Record<string, string>) => Object.fromEntries(Object.entries(style).filter(([, v]) => v !== ""))

describe("粒の仕様 (particleSpec)", () => {
  it("向きごとに、種類(data-kind)と色が決まる。確認済みは色で塗りつぶす", () => {
    expect(KIND_OF_DIR).toEqual({ down: "instruct", up: "report", cross: "cross" })
    for (const dir of DIRS) {
      const spec = particleSpec({ dir, pathKey: "k1", radius: 4.26, senderOnly: false })
      expect(spec.attrs).toEqual({ r: "4.3", class: "org-particle" })
      expect(spec.data).toEqual({ testid: PARTICLE_TESTID, kind: KIND_OF_DIR[dir], pathKey: "k1" })
      expect(spec.style).toEqual({ fill: DIR_COLOR[dir], color: DIR_COLOR[dir] })
      expect(spec.text).toBeUndefined()
    }
  })

  it("色は向きごとの CSS 変数: 指示=--flow-down・報告=--flow-up・他グループ連絡=--flow-cross", () => {
    expect(DIR_COLOR).toEqual({ down: "var(--flow-down)", up: "var(--flow-up)", cross: "var(--flow-cross)" })
  })

  it("送信側のみは、中をカードの色にして、向きの色の破線の枠にする。印(data-receipt)が付く", () => {
    for (const dir of DIRS) {
      const spec = particleSpec({ dir, pathKey: "k1", radius: 5, senderOnly: true })
      expect(spec.attrs.r).toBe("5.0")
      expect(spec.data).toEqual({ testid: PARTICLE_TESTID, kind: KIND_OF_DIR[dir], pathKey: "k1", receipt: SENDER_ONLY })
      expect(spec.style).toEqual({
        fill: "var(--card)",
        stroke: DIR_COLOR[dir],
        strokeWidth: "2",
        strokeDasharray: "2 2",
        color: DIR_COLOR[dir],
      })
    }
  })

  it("半径は小数1桁の文字列", () => {
    expect(particleSpec({ dir: "up", pathKey: "k", radius: 3, senderOnly: false }).attrs.r).toBe("3.0")
    expect(particleSpec({ dir: "up", pathKey: "k", radius: 7.04, senderOnly: false }).attrs.r).toBe("7.0")
    expect(particleSpec({ dir: "up", pathKey: "k", radius: 7.06, senderOnly: false }).attrs.r).toBe("7.1")
  })
})

describe("ラベルの仕様 (lineLabelSpec)", () => {
  it("枠の色は向きの色。本文・経路のキー・種類を持つ。送信側のみでなければ、破線と印は付かない", () => {
    for (const dir of DIRS) {
      const spec = lineLabelSpec({ dir, pathKey: "k2", senderOnly: false, text: "ログイン画面を直す" })
      expect(spec.data).toEqual({ testid: LABEL_TESTID, kind: KIND_OF_DIR[dir], pathKey: "k2" })
      expect(spec.style).toEqual({ borderColor: DIR_COLOR[dir] })
      expect(spec.text).toBe("ログイン画面を直す")
      expect(spec.attrs.class).toContain("pointer-events-none")
      expect(spec.attrs.class).toContain("absolute")
    }
  })

  it("送信側のみは、枠が破線で、印(data-receipt)が付く", () => {
    const spec = lineLabelSpec({ dir: "down", pathKey: "k2", senderOnly: true, text: "指示" })
    expect(spec.style).toEqual({ borderColor: DIR_COLOR.down, borderStyle: "dashed" })
    expect(spec.data.receipt).toBe(SENDER_ONLY)
  })
})

describe("確認済みへの切り替え (receiptConfirmedSpec)", () => {
  it("ラベル: 印を外し、枠を実線にして、本文を要約に差し替える。要約が空なら「指示」", () => {
    expect(receiptConfirmedSpec(LABEL_TESTID, "原因を調べる")).toEqual({
      attrs: {},
      data: { receipt: null },
      style: { borderStyle: "solid" },
      text: "原因を調べる",
    })
    expect(receiptConfirmedSpec(LABEL_TESTID, "").text).toBe("指示")
  })

  it("粒: 印を外し、指示の色で塗りつぶして、破線の枠を外す。文字は変えない", () => {
    expect(receiptConfirmedSpec(PARTICLE_TESTID, "無関係な要約")).toEqual({
      attrs: {},
      data: { receipt: null },
      style: { fill: DIR_COLOR.down, stroke: "", strokeWidth: "", strokeDasharray: "" },
    })
    expect(receiptConfirmedSpec(undefined, "x").text).toBeUndefined()
  })
})

describe("applySpec: 仕様を要素に当てはめる", () => {
  it("属性・data・スタイル・本文を当てはめる。data が null なら取り除く", () => {
    const target = fakeElement({ dataset: { receipt: SENDER_ONLY, kind: "instruct" } })
    applySpec(target.el, {
      attrs: { r: "4.0", class: "x" },
      data: { receipt: null, pathKey: "k" },
      style: { fill: "red" },
      text: "本文",
    })
    expect(target.attrs).toEqual({ r: "4.0", class: "x" })
    expect(target.dataset).toEqual({ kind: "instruct", pathKey: "k" })
    expect(target.style).toEqual({ fill: "red" })
    expect(target.text).toBe("本文")
  })

  it("text が無い仕様では、本文を変えない", () => {
    const target = fakeElement({ text: "もとの本文" })
    applySpec(target.el, { attrs: {}, data: {}, style: {} })
    expect(target.text).toBe("もとの本文")
  })

  it("送信側のみの粒に確認済みの切り替えを当てると、はじめから確認済みで作った粒と同じ見た目になる（印も無い）", () => {
    for (const dir of ["down"] as FlowDir[]) {
      const pending = fakeElement()
      applySpec(pending.el, particleSpec({ dir, pathKey: "k", radius: 4, senderOnly: true }))
      applySpec(pending.el, receiptConfirmedSpec(pending.dataset.testid, "要約"))

      const confirmed = fakeElement()
      applySpec(confirmed.el, particleSpec({ dir, pathKey: "k", radius: 4, senderOnly: false }))

      expect(pending.dataset).toEqual(confirmed.dataset)
      expect(effective(pending.style)).toEqual(effective(confirmed.style))
      expect(pending.attrs).toEqual(confirmed.attrs)
    }
  })

  it("送信側のみのラベルに切り替えを当てると、印が無くなり、実線・要約の本文になる", () => {
    const label = fakeElement()
    applySpec(label.el, lineLabelSpec({ dir: "down", pathKey: "k", senderOnly: true, text: "送信中の指示" }))
    expect(label.dataset.receipt).toBe(SENDER_ONLY)
    expect(label.style.borderStyle).toBe("dashed")

    applySpec(label.el, receiptConfirmedSpec(label.dataset.testid, "確認できた指示"))
    expect(label.dataset.receipt).toBeUndefined()
    expect(label.style).toMatchObject({ borderStyle: "solid", borderColor: DIR_COLOR.down })
    expect(label.text).toBe("確認できた指示")
    expect(label.dataset).toMatchObject({ testid: LABEL_TESTID, kind: "instruct", pathKey: "k" })
  })
})
