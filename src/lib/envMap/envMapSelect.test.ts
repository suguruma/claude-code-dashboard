import { describe, expect, it } from "vitest"
import { decideSession } from "./envMapSelect"

const base = { sessions: [{ id: "a" }, { id: "b" }], defaultSession: "a", skipped: [] as string[], validating: false, refreshedFor: null }

describe("[A24・中7] 一覧を覚えた状態で、後から始まったセッションを開く", () => {
  it("一覧に無い id は、取り直すまで「出せません」と言わない", () => {
    expect(decideSession({ ...base, requested: "new" })).toEqual({ kind: "checking" })
    expect(decideSession({ ...base, requested: "new", validating: true, refreshedFor: "new" })).toEqual({ kind: "checking" })
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

describe("[低12・低13] 既定のセッション", () => {
  it("頼まれていなければ直近、指示が無かったセッションは飛ばす", () => {
    expect(decideSession({ ...base, requested: null })).toEqual({ kind: "chosen", id: "a", auto: true })
    expect(decideSession({ ...base, requested: null, skipped: ["a"] })).toEqual({ kind: "chosen", id: "b", auto: true })
    expect(decideSession({ ...base, requested: null, sessions: [], defaultSession: null })).toEqual({ kind: "chosen", id: null, auto: true })
  })
})
