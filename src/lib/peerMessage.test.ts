import { describe, expect, it } from "vitest"
import { isPeerMessage, peerBodyOf } from "./peerMessage"

const PREFACE = "Another Claude session sent a message:"
const tag = (body: string, attrs = 'from="local_x" name="01_name"') => `<cross-session-message ${attrs}>\n${body}\n</cross-session-message>`
/** 実データと同じ形: 前置きの一文＋タグ＋本文＋末尾の署名の行 */
const wrapped = (body: string, attrs?: string) => `${PREFACE}\n${tag(`${body}\n\n送信元：00_name`, attrs)}`

describe("peerBodyOf: 実データの形（前置き＋タグ）", () => {
  it("前置きの一文・開始タグ・終了タグ・末尾の署名の行を除き、本文だけを返す", () => {
    expect(peerBodyOf(wrapped("ログイン画面のエラー表示を直してください"))).toBe("ログイン画面のエラー表示を直してください")
  })

  it("複数行の本文はそのまま残す（先頭の飾りと末尾の署名だけを外す）", () => {
    expect(peerBodyOf(wrapped("1行目\n\n2行目\n3行目"))).toBe("1行目\n\n2行目\n3行目")
  })

  it("作業中に届いた形（queued_command）は、前置きが無く、タグから始まる", () => {
    expect(peerBodyOf(tag("追加の依頼です"))).toBe("追加の依頼です")
  })

  it("外部（CLI）の形: タグの属性が違っても、同じように除く", () => {
    const attrs = 'from="uds:synthetic" from-session="s-1" from-name="cli" from-mode="uds"'
    expect(peerBodyOf(wrapped("外部からの依頼", attrs))).toBe("外部からの依頼")
  })

  it("別の包み（agent-message）も、前置きと開始・終了タグを除く。本文の中のタグはそのまま", () => {
    const text = `${PREFACE}\n<agent-message from="local_x">\n本文 <audio>x</audio> 続き\n</agent-message>`
    expect(peerBodyOf(text)).toBe("本文 <audio>x</audio> 続き")
  })

  it("タグの属性の値に `>` や引用符が入っていても、開始タグの終わりを取り違えない", () => {
    expect(peerBodyOf(wrapped("本文", 'from="local_x" name="a>b" note=\'it"s\''))).toBe("本文")
  })
})

describe("peerBodyOf: 古い形式・境界", () => {
  it("前置きもタグも無い本文は、そのまま", () => {
    expect(peerBodyOf("ただの本文です")).toBe("ただの本文です")
    expect(peerBodyOf("")).toBe("")
    expect(peerBodyOf("   \n  ")).toBe("")
  })

  it("タグだけ（本文なし）・前置きだけは空文字", () => {
    expect(peerBodyOf('<cross-session-message from="local_x"></cross-session-message>')).toBe("")
    expect(peerBodyOf(`${PREFACE}\n<cross-session-message from="local_x">\n</cross-session-message>`)).toBe("")
    expect(peerBodyOf(PREFACE)).toBe("")
  })

  it("タグが無く、前置きの一文と本文だけの形でも、前置きを除く（改行・同じ行・CRLF・大文字小文字）", () => {
    expect(peerBodyOf(`${PREFACE}\n本文です`)).toBe("本文です")
    expect(peerBodyOf(`${PREFACE} 本文です`)).toBe("本文です")
    expect(peerBodyOf(`${PREFACE}\r\n\r\n本文です\r\n\r\n送信元：00_name`)).toBe("本文です")
    expect(peerBodyOf(`  \n${PREFACE.toLowerCase()}\n本文です`)).toBe("本文です")
    // 前置きが本文の途中にあるときは、本文のまま
    expect(peerBodyOf(`本文の途中に ${PREFACE} が出てくる`)).toBe(`本文の途中に ${PREFACE} が出てくる`)
  })

  it("前置きの文言が変わっても、cross-session-message のタグより前は前置きとして除く（先頭から300文字以内）", () => {
    expect(peerBodyOf(`A different preface sentence.\n${tag("本文")}`)).toBe("本文")
    const long = `${"あ".repeat(301)}\n${tag("本文")}`
    expect(peerBodyOf(long).startsWith("あ")).toBe(true)
  })

  it("別の包みで、前置きが「…:」で終わる短い1行のときだけ、その行を前置きとみなす", () => {
    expect(peerBodyOf('Message from another session:\n<agent-message from="x">\n本文\n</agent-message>')).toBe("本文")
    // タグの行が続かなければ、本文の一部
    expect(peerBodyOf("次のとおりです：\n本文")).toBe("次のとおりです：\n本文")
    // 「:」で終わらない行は前置きにしない
    expect(peerBodyOf('見出し\n<agent-message from="x">本文</agent-message>')).toBe("見出し\n<agent-message from=\"x\">本文</agent-message>")
  })

  it("終了タグが無い（途中で切れた）・名前が合わない終了タグは、そのまま本文に残す", () => {
    expect(peerBodyOf(`${PREFACE}\n<cross-session-message from="x">\n本文`)).toBe("本文")
    expect(peerBodyOf('<cross-session-message from="x">本文</other>')).toBe("本文</other>")
  })

  it("CRLF の改行でも同じ", () => {
    expect(peerBodyOf(wrapped("本文").replace(/\n/g, "\r\n"))).toBe("本文")
  })
})

describe("peerBodyOf: 要約の先頭に来てはいけないもの", () => {
  it("先頭の空行・区切り線・見出しの記号だけの行を飛ばす", () => {
    expect(peerBodyOf(wrapped("\n\n---\n\n# \n本文"))).toBe("本文")
    expect(peerBodyOf(wrapped("===\n***\n本文"))).toBe("本文")
  })

  it("先頭の見出し・引用の記号を外す（記号のあとの文字は残す）。番号付きの見出し（#12）は外さない", () => {
    expect(peerBodyOf(wrapped("## 依頼\n詳細"))).toBe("依頼\n詳細")
    expect(peerBodyOf(wrapped("> 引用された依頼"))).toBe("引用された依頼")
    expect(peerBodyOf(wrapped("#12 の不具合"))).toBe("#12 の不具合")
  })

  it("末尾の署名の行（「送信元：…」）と、その前後の空行は、本文に含めない。本文が署名だけなら空", () => {
    expect(peerBodyOf(tag("本文\n\n送信元：00_name\n\n"))).toBe("本文")
    expect(peerBodyOf(tag("本文\n送信元: 00_name"))).toBe("本文")
    expect(peerBodyOf(tag("送信元：00_name"))).toBe("")
    // 署名が途中にあるときは、本文として残す
    expect(peerBodyOf(tag("送信元：00_name\n本文"))).toBe("送信元：00_name\n本文")
  })
})

describe("isPeerMessage", () => {
  it("前置きの有無にかかわらず、cross-session-message の包みを見分ける（先頭から300文字以内）", () => {
    expect(isPeerMessage(tag("本文"))).toBe(true)
    expect(isPeerMessage(`  \n${tag("本文")}`)).toBe(true)
    expect(isPeerMessage(wrapped("本文"))).toBe(true)
    expect(isPeerMessage(`${"あ".repeat(301)}\n${tag("本文")}`)).toBe(false)
    // タグが付かず、前置きの一文だけが付く形も、他のセッションからのメッセージ
    expect(isPeerMessage(`${PREFACE}\n本文`)).toBe(true)
    expect(isPeerMessage("ただの本文")).toBe(false)
    expect(isPeerMessage("<task-notification>完了</task-notification>")).toBe(false)
    expect(isPeerMessage("")).toBe(false)
  })
})
