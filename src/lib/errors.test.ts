import { describe, expect, it } from "vitest"
import { errorResponse, readJsonBody } from "./apiHelpers"
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

  it("種類のない（想定外の）エラーと FileIOError は 500。想定外のエラーを 400 などにする逃げ道は無い", async () => {
    expect(errorResponse(new Error("x")).status).toBe(500)
    expect(errorResponse(new FileIOError("x")).status).toBe(500)
    expect(errorResponse(new SyntaxError("Unexpected token")).status).toBe(500)
  })

  it("Error でない値は fallbackMessage(無ければ既定の文言)", async () => {
    expect(await errorResponse("boom").json()).toEqual({ error: "予期しないエラーが発生しました" })
    expect(await errorResponse("boom", { fallbackMessage: "保存に失敗しました" }).json()).toEqual({
      error: "保存に失敗しました",
    })
  })
})

describe("readJsonBody: リクエストの本文を JSON のオブジェクトとして読む", () => {
  const post = (body?: string) => new Request("http://localhost/api/test", { method: "POST", body })

  it("JSON のオブジェクトはそのまま返す", async () => {
    expect(await readJsonBody(post('{"a":1,"b":"x"}'))).toEqual({ a: 1, b: "x" })
    expect(await readJsonBody(post("{}"))).toEqual({})
  })

  it("壊れた JSON は InvalidInputError（400）。文言に、本文の内容も解析エラーの内容も入れない", async () => {
    const secret = "SECRET-BODY-TEXT"
    for (const body of [`{"a": ${secret}`, "{", "", "undefined", "not json"]) {
      const error = await readJsonBody(post(body)).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(InvalidInputError)
      expect(statusOfError(error)).toBe(400)
      expect((error as Error).message).toBe("リクエストの本文を JSON として読めません")
      expect((error as Error).message).not.toContain(secret)
    }
  })

  it("JSON でも、オブジェクトでない本文（null・配列・数値・文字列・真偽値）は InvalidInputError（400）", async () => {
    for (const body of ["null", "[]", "[1,2]", "5", '"text"', "true"]) {
      const error = await readJsonBody(post(body)).catch((e: unknown) => e)
      expect(error, body).toBeInstanceOf(InvalidInputError)
      expect((error as Error).message).toBe("リクエストの本文は JSON のオブジェクトで指定してください")
    }
  })

  it("optional: 本文が空（空白だけを含む）なら {}。空でなければ、壊れた JSON は 400", async () => {
    expect(await readJsonBody(post(), { optional: true })).toEqual({})
    expect(await readJsonBody(post("  " + String.fromCharCode(10)), { optional: true })).toEqual({})
    expect(await readJsonBody(post('{"targetProjectId":"p"}'), { optional: true })).toEqual({ targetProjectId: "p" })
    await expect(readJsonBody(post("{"), { optional: true })).rejects.toBeInstanceOf(InvalidInputError)
    // optional でなければ、空の本文は 400
    await expect(readJsonBody(post())).rejects.toBeInstanceOf(InvalidInputError)
  })
})
