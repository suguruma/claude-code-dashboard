import { afterEach, describe, expect, it, vi } from "vitest"
import { openOnRowClick } from "./HousekeepingList"

/** DOM が無い環境（node）で、クリックの対象と文字の選択だけを模して openOnRowClick を確かめる */
function clickOn(handler: ReturnType<typeof openOnRowClick>, insideInteractive: boolean) {
  const target = { closest: (selector: string) => (insideInteractive && selector.includes("button") ? {} : null) }
  handler({ target } as unknown as Parameters<typeof handler>[0])
}

function stubSelection(text: string) {
  vi.stubGlobal("window", { getSelection: () => ({ toString: () => text }) })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("openOnRowClick", () => {
  it("行の空いた場所を押すと、その行の ID で詳細を開く", () => {
    stubSelection("")
    const onSelect = vi.fn()
    clickOn(openOnRowClick(onSelect, "local_a"), false)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("local_a")
  })

  it("行の中のボタン・リンクを押したときは、行としては開かない（ボタン自身の動作に任せる）", () => {
    stubSelection("")
    const onSelect = vi.fn()
    clickOn(openOnRowClick(onSelect, "local_a"), true)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("文字を選択しているとき（コピーのためのドラッグ）は開かない", () => {
    stubSelection("選択中の文字")
    const onSelect = vi.fn()
    clickOn(openOnRowClick(onSelect, "local_a"), false)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("選択の取得ができない環境（getSelection が null を返す）でも、開く", () => {
    vi.stubGlobal("window", { getSelection: () => null })
    const onSelect = vi.fn()
    clickOn(openOnRowClick(onSelect, "local_b"), false)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("local_b")
  })
})
