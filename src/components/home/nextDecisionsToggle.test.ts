import { readFileSync } from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { NextDecisions } from "./NextDecisions"

const onRetry = async () => {}

describe("[ND-11] 次にやる判断を閉じる・開く(オーナーの指示 10/25。A28)", () => {
  it("見出しが開閉のボタンで、初めは開いている。中身はボタンと結ぶ", () => {
    const html = renderToStaticMarkup(createElement(NextDecisions, { sessions: [], phase: "ready", now: 0, onRetry }))
    expect(html).toMatch(/<h2[^>]*><button[^>]*aria-expanded="true"[^>]*aria-controls="home-decisions-body"/)
    expect(html).toMatch(/id="home-decisions-body"(?![^>]*hidden)/)
    expect(html).toContain("いま決めることはありません。")
  })

  it("件数と読み込めなかった知らせは、中身の外に出す(閉じても見える)", () => {
    const ready = renderToStaticMarkup(createElement(NextDecisions, { sessions: [], phase: "ready", now: 0, onRetry }))
    expect(ready.indexOf('data-testid="home-decisions-count"')).toBeLessThan(ready.indexOf('id="home-decisions-body"'))
    const failed = renderToStaticMarkup(createElement(NextDecisions, { sessions: null, phase: "failed", now: 0, onRetry }))
    expect(failed.indexOf("読み込めませんでした")).toBeLessThan(failed.indexOf('id="home-decisions-body"'))
  })

  it("閉じていたら描画の前に印を付け、globals.css がハイドレーションの前から中身を隠す(後から縮んで画面がずれないように)", () => {
    const html = renderToStaticMarkup(createElement(NextDecisions, { sessions: null, phase: "loading", now: 0, onRetry }))
    expect(html).toContain('localStorage.getItem("ccd:home-decisions-open")==="false"')
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8")
    expect(css).toMatch(/html\[data-home-decisions="closed"\] #home-decisions-body \{\s*display: none;/)
  })
})
