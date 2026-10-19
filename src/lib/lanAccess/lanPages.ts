/**
 * LAN の入り口が自分で返す、スマホ向けの短いページ(登録の案内・コードのまちがいなど)。
 * 外部の読み込み・スクリプトは使わない。鍵・コードは入れない。
 */

export type LanPageKind = "register" | "expired" | "invalid" | "locked" | "full"

const HOW_TO =
  "<ol><li>PC で Claude Code Dashboard を開き、サイドバーの「ツール」の「スマホから見る」を押します。</li>" +
  "<li>「登録コードを出す」を押し、出てきた QR コードを、このスマホのカメラで読み取ります。</li>" +
  "<li>登録できたら、このページをブックマーク（ホーム画面に追加）して、次からはそこから開きます。</li></ol>" +
  "<p class=\"note\">スマホの IP アドレスを PC に入れる必要はありません。</p>"

const PAGES: Record<LanPageKind, { title: string; body: string }> = {
  register: {
    title: "この端末は登録されていません",
    body: `<p>スマホから見るには、PC の画面でこの端末を登録します（読み取り専用）。</p>${HOW_TO}`,
  },
  expired: {
    title: "登録コードの期限が切れています",
    body: `<p>登録コードは5分だけ使えます。PC の画面で、もう一度「登録コードを出す」を押してください。</p>${HOW_TO}`,
  },
  invalid: {
    title: "登録コードが正しくないか、使い終わっています",
    body: `<p>登録コードは1回だけ使えます。PC の画面で、もう一度「登録コードを出す」を押してください。</p>${HOW_TO}`,
  },
  locked: {
    title: "登録を一時的に止めています",
    body: "<p>まちがったコードが続いたため、登録を止めています。PC の画面で「登録コードを出す」を押すと、また登録できます。</p>",
  },
  full: {
    title: "登録できる端末の数を超えています",
    body: "<p>PC の画面の「スマホから見る」で、使わない端末を取り消してから、もう一度登録してください。</p>",
  },
}

export function lanPage(kind: LanPageKind): string {
  const page = PAGES[kind]
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${page.title}｜Claude Code Dashboard</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:24px 16px;line-height:1.7;background:#fff;color:#171717}
main{max-width:32rem;margin:0 auto}h1{font-size:1.15rem;margin:0 0 12px}
ol{padding-left:1.3rem}.note{color:#525252;font-size:.9rem}
@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#ededed}.note{color:#a3a3a3}}
</style></head>
<body><main><h1>${page.title}</h1>${page.body}</main></body></html>`
}
