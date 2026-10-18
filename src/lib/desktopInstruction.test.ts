import { describe, expect, it } from "vitest"
import { isInstructionProvisional } from "./desktopInstruction"
import type { DesktopSessionSummary, InstructionOrigin } from "./desktopSessionTypes"

const instruction = (origin: InstructionOrigin): DesktopSessionSummary["latestInstruction"] => ({
  excerpt: "本文",
  origin,
  at: 1_800_000_000_000,
})

describe("isInstructionProvisional: 最新の指示が暫定（解析中）か", () => {
  it("暫定の要約（partial）で、最新の指示が人以外（他セッション・通知・定期実行・システム）なら、暫定", () => {
    for (const origin of ["peer", "notification", "scheduled", "system"] as const) {
      expect(isInstructionProvisional({ digest: "partial", latestInstruction: instruction(origin) })).toBe(true)
    }
  })

  it("暫定の要約（partial）で、指示がまだ見つかっていない（null）ときも、暫定", () => {
    expect(isInstructionProvisional({ digest: "partial", latestInstruction: null })).toBe(true)
  })

  it("暫定の要約（partial）でも、最新の指示が人のものなら、暫定ではない（人の指示は置き換わらない）", () => {
    expect(isInstructionProvisional({ digest: "partial", latestInstruction: instruction("human") })).toBe(false)
  })

  it("全体の解析が済んだ（full）あとは、発信元にかかわらず暫定ではない", () => {
    for (const origin of ["human", "peer", "notification", "scheduled", "system"] as const) {
      expect(isInstructionProvisional({ digest: "full", latestInstruction: instruction(origin) })).toBe(false)
    }
    expect(isInstructionProvisional({ digest: "full", latestInstruction: null })).toBe(false)
  })

  it("会話ログが無い（none）ときは、解析中ではないので暫定ではない", () => {
    expect(isInstructionProvisional({ digest: "none", latestInstruction: null })).toBe(false)
    expect(isInstructionProvisional({ digest: "none", latestInstruction: instruction("peer") })).toBe(false)
  })
})
