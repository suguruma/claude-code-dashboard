"use client"

import type { EnvMapStrength } from "@/lib/envMap/envMapTypes"

/**
 * ⑲ 地図の色。Dashboard の色の決まり(CSS の変数)から作る。ひな形の色は使わない(要件メモ 3-4)。
 * globals.css の値は oklch(...) で、cytoscape は hex・rgb・hsl しか解釈しないので、1px の canvas に塗って rgb に直す(相談役 重4)。
 * ルートの光は --flow-down(青系)。赤系(--destructive)は止める・食い違いだけ(A18)。
 */

export interface EnvMapColors {
  bg: string
  fg: string
  muted: string
  border: string
  box: string
  route: string
  routeText: string
  danger: string
  bandA: string
  bandB: string
}

let probe: CanvasRenderingContext2D | null = null

/** CSS の色の値を rgb(...) に直す。直せなければ fallback */
export function toRgb(value: string, fallback: string): string {
  const v = value.trim()
  if (!v) return fallback
  if (/^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/i.test(v)) return v
  if (typeof document === "undefined") return fallback
  if (!probe) {
    const c = document.createElement("canvas")
    c.width = 1
    c.height = 1
    probe = c.getContext("2d", { willReadFrequently: true })
  }
  if (!probe) return fallback
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = "#000"
  probe.fillStyle = v
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`
}

/** 今のテーマの色を読む(テーマを替えたら読み直す。A19) */
export function readColors(el: Element = document.documentElement): EnvMapColors {
  const cs = getComputedStyle(el)
  const v = (name: string, fallback: string) => toRgb(cs.getPropertyValue(name), fallback)
  return {
    bg: v("--background", "#ffffff"),
    fg: v("--foreground", "#111111"),
    muted: v("--muted-foreground", "#555555"),
    border: v("--border", "#cccccc"),
    box: v("--card", "#ffffff"),
    route: v("--flow-down", "#2f6fec"),
    routeText: v("--flow-down-text", "#2659bd"),
    danger: v("--destructive", "#d92d20"),
    bandA: v("--muted", "#f4f4f5"),
    bandB: v("--background", "#ffffff"),
  }
}

/** 強さの凡例(画面の言葉。英語を出さない。A27) */
export const STRENGTH_TEXT: Record<EnvMapStrength, string> = {
  stop: "止める",
  judge: "判定する",
  watch: "記録だけ",
  read: "読ませるだけ",
  none: "",
}

/**
 * 強さは形と線で分ける(止める＝太い枠・判定する＝二重の枠・記録だけ＝点線・読ませるだけ＝実線の枠・強さなし＝細い灰色の枠)。
 * muted が true の枠は、前景の色ではなく灰色(--muted-foreground)で描く(低1:読ませるだけと強さなしを分ける)
 */
export function strengthBorder(s: EnvMapStrength): { width: number; style: "solid" | "dashed" | "double"; muted: boolean } {
  switch (s) {
    case "stop":
      return { width: 4, style: "solid", muted: false }
    case "judge":
      return { width: 5, style: "double", muted: false }
    case "watch":
      return { width: 2, style: "dashed", muted: false }
    case "read":
      return { width: 2, style: "solid", muted: false }
    default:
      return { width: 1, style: "solid", muted: true }
  }
}

/** 食い違う決まりの線:赤に加えて破線と太さで分ける(白黒でも通常の線と見分ける。中2) */
export const CONFLICT_EDGE = { width: 3.5, style: "dashed" as const, dash: [8, 4], arrow: "tee" as const }
/** 通常の線 */
export const NORMAL_EDGE = { width: 1.5, style: "solid" as const }
