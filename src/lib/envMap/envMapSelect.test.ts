import { describe, expect, it } from "vitest"
import { decideSession, liveSkipped } from "./envMapSelect"

const base = { sessions: [{ id: "a" }, { id: "b" }], defaultSession: "a", skipped: [] as string[], validating: false, refreshedFor: null }

describe("[A24・中7] 一覧を覚えた状態で、後から始まったセッションを開く", () => {
  it("一覧に無い id は、取り直すまで「出せません」と言わない", () => {
    expect(decideSession({ ...base, requested: "new" })).toEqual({ kind: "checking" })
    expect(decideSession({ ...base, requested: "new", validating: true, refreshedFor: null })).toEqual({ kind: "checking" })
  })
  it("取り直した一覧にあれば、そのセッション", () => {
    expect(decideSession({ ...base, sessions: [...base.sessions, { id: "new" }], requested: "new", refreshedFor: "new" })).toEqual({
      kind: "chosen",
      id: "new",
      auto: false,
    })
  })
  it("取り直しても無ければ「出せません」(別のセッションに差し替えない)", () => {
    expect(decideSession({ ...base, requested: "gone", refreshedFor: "gone" })).toEqual({ kind: "missing" })
  })
  it("前に取り直したのが別の id なら、もう一度取り直す", () => {
    expect(decideSession({ ...base, requested: "gone2", refreshedFor: "gone" })).toEqual({ kind: "checking" })
  })
})

describe("[完了前の相談役 低1] 取り直し終えた後の再取得", () => {
  it("一度取り直して無かった id は、後の取り直しの間も「出せません」のまま(地図を外さない)", () => {
    expect(decideSession({ ...base, requested: "gone", validating: true, refreshedFor: "gone" })).toEqual({ kind: "missing" })
  })
})

describe("[完了前の相談役 中1] 飛ばしたセッションに後から指示が入る", () => {
  const list = [
    { id: "a", lastActivityAt: 100 },
    { id: "b", lastActivityAt: 50 },
  ]
  it("飛ばした時から動いていなければ、飛ばしたまま", () => {
    expect(liveSkipped([{ id: "a", at: 100 }], list)).toEqual(["a"])
  })
  it("飛ばした後に動いたセッションは、飛ばさない(直近に戻る)", () => {
    const moved = [{ id: "a", lastActivityAt: 200 }, list[1]]
    const skipped = liveSkipped([{ id: "a", at: 100 }], moved)
    expect(skipped).toEqual([])
    expect(decideSession({ ...base, requested: null, skipped })).toEqual({ kind: "chosen", id: "a", auto: true })
  })
  it("一覧から消えたセッションは数えない", () => {
    expect(liveSkipped([{ id: "gone", at: 1 }, { id: "b", at: 50 }], list)).toEqual(["b"])
  })
})

describe("[低12・低13] 既定のセッション", () => {
  it("頼まれていなければ直近、指示が無かったセッションは飛ばす", () => {
    expect(decideSession({ ...base, requested: null })).toEqual({ kind: "chosen", id: "a", auto: true })
    expect(decideSession({ ...base, requested: null, skipped: ["a"] })).toEqual({ kind: "chosen", id: "b", auto: true })
    expect(decideSession({ ...base, requested: null, sessions: [], defaultSession: null })).toEqual({ kind: "chosen", id: null, auto: true })
  })
})
