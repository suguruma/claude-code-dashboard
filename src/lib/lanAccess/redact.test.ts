import { describe, expect, it } from "vitest"
import { lastSegment, redactForLan } from "./redact"

/** フォルダのパスらしい文字列(ドライブ・UNC・\・ホームの下の POSIX のパス・パスを - でつないだ名前・URL エンコード) */
const PATH_LIKE = /[A-Za-z]:[\\/]|\\|\/(Users|home|mnt|root)\/|[A-Za-z]--Users|%3A%5C|~[\\/]/i

describe("スマホへ返す応答のパスを隠す（すき間）", () => {
  it("ホームのフォルダそのものは、ユーザー名を出さずに ~ にする", () => {
    expect(redactForLan({ cwd: "C:\\Users\\someone" }).cwd).toBe("~")
    expect(redactForLan({ cwd: "C:\\Users\\someone\\" }).cwd).toBe("~")
    expect(redactForLan({ cwd: "/Users/someone" }).cwd).toBe("~")
    expect(redactForLan({ cwd: "/home/someone/" }).cwd).toBe("~")
    expect(redactForLan({ cwd: "C:\\Users\\someone\\work" }).cwd).toBe("work")
    expect(redactForLan({ text: "作業場所: C:\\Users\\someone です" }).text).toBe("作業場所: ~ です")
  })

  it("~\\…・URL エンコードしたパス・パスを - でつないだ名前・file:///… も隠す", () => {
    expect(redactForLan("~\\work\\app を開く")).toBe("app を開く")
    expect(redactForLan("~/work/app を開く")).toBe("app を開く")
    expect(redactForLan("C%3A%5CUsers%5Csomeone%5Cx.json が無い")).toBe("x.json が無い")
    expect(redactForLan("c%3a%2fUsers%2fsomeone%2fy.json")).toBe("y.json")
    expect(redactForLan("フォルダ C--Users-someone-work-app を読む")).toBe("フォルダ … を読む")
    expect(redactForLan("開く: file:///C:/Users/someone/a/b.txt")).toBe("開く: b.txt")
    expect(redactForLan("file:///C:/Users/someone")).toBe("~")
  })

  it("オブジェクトのキーにあるパスも隠す", () => {
    const out = redactForLan({ "C:\\Users\\someone\\proj": 1, "/home/someone/x": { "D:\\data\\y": 2 } })
    expect(Object.keys(out)).toEqual(["proj", "x"])
    expect(JSON.stringify(out)).not.toMatch(PATH_LIKE)
  })

  it("空白を含むパスは、空白の前後とも残さない", () => {
    const out = redactForLan("読めません: C:\\Users\\some one\\my proj\\a.json")
    expect(out).not.toMatch(PATH_LIKE)
    expect(out).not.toContain("some")
    expect(out).toContain("a.json")
  })

  it("作業フォルダの最後の名前(folderName)は、cwd から作り直す。ホームのフォルダそのものなら ~ で、ユーザー名を出さない", () => {
    expect(redactForLan({ cwd: "C:\\Users\\someone", folderName: "someone" })).toEqual({ cwd: "~", folderName: "~" })
    expect(redactForLan({ cwd: "/Users/someone/", folderName: "someone" })).toEqual({ cwd: "~", folderName: "~" })
    expect(redactForLan({ cwd: "C:\\Users\\someone\\work", folderName: "work" })).toEqual({ cwd: "work", folderName: "work" })
    // cwd が無いのに名前だけがある(ふつうは無い)ときも、名前は出さない
    expect(redactForLan({ cwd: null, folderName: "someone" })).toEqual({ cwd: null, folderName: null })
    expect(redactForLan({ folderName: "someone" })).toEqual({ folderName: null })
    // 一覧の中のセッション(配列の中のオブジェクト)でも同じ
    const list = redactForLan({ sessions: [{ id: "local_a", cwd: "C:\\Users\\someone", folderName: "someone", title: "作業" }] })
    expect(JSON.stringify(list)).not.toContain("someone")
    // 名前の決まりに無いキー(toString など)は、ふつうの値として扱う
    expect(redactForLan({ toString: "x", constructor: "y" })).toEqual({ toString: "x", constructor: "y" })
  })

  it("Windows の長いパスの前置き(\\\\?\\・\\\\.\\・\\\\?\\UNC\\)があっても、ホームのフォルダそのものは ~ にし、名前を出さない", () => {
    expect(redactForLan({ cwd: "\\\\?\\C:\\Users\\someone", folderName: "someone" })).toEqual({ cwd: "~", folderName: "~" })
    expect(redactForLan({ cwd: "\\\\.\\C:\\Users\\someone\\" }).cwd).toBe("~")
    expect(redactForLan({ cwd: "//?/C:/Users/someone" }).cwd).toBe("~")
    expect(redactForLan({ cwd: "\\\\?\\C:\\Users\\someone\\work", folderName: "work" })).toEqual({ cwd: "work", folderName: "work" })
    expect(redactForLan({ cwd: "\\\\?\\UNC\\server\\share\\proj" }).cwd).toBe("proj")
    expect(redactForLan("作業場所: \\\\?\\C:\\Users\\someone です")).toBe("作業場所: ~ です")
    expect(lastSegment("\\\\?\\C:\\")).toBe("")
  })

  it("macOS の外付けの場所(/Volumes/<名前>/…)も隠す", () => {
    expect(redactForLan("開く: /Volumes/someone-disk/work/a.txt")).toBe("開く: a.txt")
    expect(redactForLan({ cwd: "/Volumes/someone-disk/work" }).cwd).toBe("work")
  })

  it("パスでない文は、そのまま", () => {
    for (const s of ["送信 3/10", "a/b の比較", "12:30 に報告", "https://example.com/home/x", "1/2/3", "C 言語", "Q&A: 何？"]) {
      expect(redactForLan(s), s).toBe(s)
    }
  })

  it("最後の名前の取り出し", () => {
    expect(lastSegment("C:\\")).toBe("")
    expect(lastSegment("C:\\work\\app")).toBe("app")
    expect(lastSegment("\\\\server\\share\\dir")).toBe("dir")
  })
})
