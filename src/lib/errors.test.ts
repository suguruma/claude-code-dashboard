import { describe, expect, it } from "vitest"
import { errorResponse } from "./apiHelpers"
import { ConflictError, FileIOError, InvalidInputError, messageOfError, NotFoundError, statusOfError } from "./errors"
import { FileIOError as FileIOErrorFromFileIO } from "./fileIO"

describe("statusOfError: 状態コードはエラーの種類で決まる", () => {
  it.each([
    ["入力の誤り", new InvalidInputError("x"), 400],
    ["見つからない", new NotFoundError("x"), 404],
    ["衝突", new ConflictError("x"), 409],
    ["ファイルの読み書き", new FileIOError("x"), 500],
    ["想定外の Error", new Error("x"), 500],
    ["Error でない値", "文字列", 500],
    ["null", null, 500],
  ])("%s → %i", (_label, err, status) => {
    expect(statusOfError(err)).toBe(status)
  })

  it("想定外のエラーの状態コードは fallbackStatus で変えられる。種類のあるエラーには効かない", () => {
    expect(statusOfError(new Error("x"), 400)).toBe(400)
    expect(statusOfError("文字列", 404)).toBe(404)
    expect(statusOfError(new NotFoundError("x"), 400)).toBe(404)
    expect(statusOfError(new FileIOError("x"), 400)).toBe(500)
  })

  it("文言を変えても状態コードは変わらない（同じ種類は、どんな文言でも同じ状態コード）", () => {
    for (const message of ["不正な入力です", "見つかりません", "既に存在します", "", "Something else"]) {
      expect(statusOfError(new InvalidInputError(message))).toBe(400)
      expect(statusOfError(new NotFoundError(message))).toBe(404)
      expect(statusOfError(new ConflictError(message))).toBe(409)
    }
  })

  it("かつて状態コードを決めていた語（不正な・見つかりません・既に存在します）を含んでも、種類がなければ 500", () => {
    for (const message of ["不正な指定です", "スキルが見つかりません", "スキル \"a\" は既に存在します"]) {
      expect(statusOfError(new Error(message))).toBe(500)
    }
  })

  it("エラーの種類は Error を継承し、instanceof と message が使える。種類どうしは別物", () => {
    const err = new NotFoundError("ないです")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err).not.toBeInstanceOf(InvalidInputError)
    expect(err).not.toBeInstanceOf(ConflictError)
    expect(err.message).toBe("ないです")
  })

  it("@/lib/fileIO から import した FileIOError は、errors.ts の FileIOError と同じクラス（既存の import 元が変わらない）", () => {
    expect(FileIOErrorFromFileIO).toBe(FileIOError)
  })
})

describe("messageOfError", () => {
  it("Error なら message、そうでなければ既定の文言(または指定の文言)", () => {
    expect(messageOfError(new Error("理由"))).toBe("理由")
    expect(messageOfError(123)).toBe("予期しないエラーが発生しました")
    expect(messageOfError(undefined, "更新に失敗しました")).toBe("更新に失敗しました")
  })
})

describe("errorResponse: API ルートの catch で使う変換", () => {
  it("状態コードと { error } の本文を返す", async () => {
    const res = errorResponse(new ConflictError("競合しています"))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "競合しています" })
  })

  it("想定外のエラーは 500、fallbackStatus を渡せば、その状態コード。FileIOError は fallbackStatus に関わらず 500", async () => {
    expect(errorResponse(new Error("x")).status).toBe(500)
    expect(errorResponse(new Error("x"), { fallbackStatus: 400 }).status).toBe(400)
    expect(errorResponse(new FileIOError("x"), { fallbackStatus: 400 }).status).toBe(500)
  })

  it("Error でない値は fallbackMessage(無ければ既定の文言)", async () => {
    expect(await errorResponse("boom").json()).toEqual({ error: "予期しないエラーが発生しました" })
    expect(await errorResponse("boom", { fallbackMessage: "保存に失敗しました" }).json()).toEqual({
      error: "保存に失敗しました",
    })
  })
})
