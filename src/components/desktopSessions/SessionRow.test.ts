import { describe, expect, it } from "vitest"
import { sideChatLabel } from "./SessionRow"

describe("sideChatLabel", () => {
  it("親のタイトルを括弧の中に出す。補助のセッション（補助A_…）が親でも同じ形", () => {
    expect(sideChatLabel("01_画面の修正")).toBe("サイドチャット（親：01_画面の修正）")
    expect(sideChatLabel("補助A_さらに下の確認")).toBe("サイドチャット（親：補助A_さらに下の確認）")
  })

  it("親が一覧に無い（または名前が空）ときも、印は出す", () => {
    expect(sideChatLabel(null)).toBe("サイドチャット（親：一覧に無いセッション）")
    expect(sideChatLabel(undefined)).toBe("サイドチャット（親：一覧に無いセッション）")
    expect(sideChatLabel("")).toBe("サイドチャット（親：一覧に無いセッション）")
  })
})
