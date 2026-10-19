/**
 * 組織図（/desktop-sessions の「組織図」）の動作確認用に、合成（架空）の Claude Desktop データを作る。
 * 実際のセッション名・ID・指示の文面は含まない。現在時刻を基準に、直近4時間の出来事を作るので、
 * 画面を開く直前に実行する（古くなったら作り直す）。
 *
 * 使い方:
 *   node scripts/make-org-chart-sample.mjs <出力先のフォルダ>
 *   node scripts/make-org-chart-sample.mjs --guard <出力先のフォルダ>   (利用上限の記録の5時間を92%にする。上限ガードの帯の確認用)
 *   node scripts/make-org-chart-sample.mjs --append-human-input <出力先のフォルダ>   (止まっている子へ、作業中の人の入力を追記)
 * 出力先に data/（Desktopのデータ）・projects/（会話ログ）・usage-snapshots.jsonl（利用上限の公式値の記録）ができる。
 * 表示される設定を、config/desktop-sessions.json と config/usage.json に書いて開発サーバーを起動する。
 * 期待値は出力先の expected.json にも書く(撮影の前の確認 scripts/check-sample-server.mjs が読む)。
 * 撮影・確認のサーバーは、環境変数 CCD_DESKTOP_AUTODETECT=0 を付けて起動する(設定ファイルが無くても、この PC の本物の
 * Claude Desktop のデータ・会話ログ・利用上限の記録を自動で探さない)。
 *
 * 作るもの（グループ「試験グループ」と「別グループ」）:
 *   試験グループ: 指揮役1・子4。指示8（うち送信側のみ1）・報告5（うち組にならないもの1）・報告なしで終了2・
 *                 他グループからの連絡1・外部（CLI）からの連絡1・圧縮1・作業中の子1・コンテキスト80%超と90%超・
 *                 送信上限で停止中の子1・作業量が満杯（82回）を超える指示1
 *                 3層目（子が作った補助のセッション）: 指示・報告のやりとりがあるもの（グループの外）1・
 *                 4層目（3層目が作ったもの。2層目の祖先の下にまとめて出る）1・グループ内の子が作ったもの1・
 *                 やりとりが無くて作業中のもの1。指揮役が作ったグループ外のセッション（2層目に出る）1。
 *                 木に出ないもの: 親が見つからないグループ外のセッション1・アーカイブ済み1
 *                 サイドチャット（Desktop の分岐の操作で作った脇の会話）1: 画面の修正から開いたもの。カードにはならず、
 *                 画面の修正のカードに「サイドチャット 1」と出る（同じ親の作業用の子「補助B」はカードになる）
 *   別グループ:   指揮役1・子1。指示1・報告1。子が作ったグループ外のセッション1（3層目に出る）
 *   利用上限の公式値の記録2件（2時間前と2分前。5時間 5%→22%・週 12%→14%。--guard では最後の5時間が92%）
 *   判断待ち（整理ページ用。どのグループにも入っていない）4: 質問の回答待ち・要約が要対応・エラー・宛先不明の送信
 *   組織のルール（⑨）: グローバルの CLAUDE.md（出力先の global/）、指揮役2人の作業フォルダ（出力先の work/。試験グループの
 *                 指揮役だけ CLAUDE.md あり）と記憶（会話ログのフォルダの memory）、指揮役でないセッションの記憶（読まれては
 *                 いけないもの。中身は実行のたびに変わる目印の文字列）、追加のファイル（出力先の extras/）。
 *                 指揮役2人の会話ログは、それぞれ別のフォルダに置く（記憶は会話ログのフォルダごとのため）
 */
import { randomUUID } from "node:crypto"
import { appendFile, mkdir, rm, writeFile, utimes } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ACCOUNT = "00000000-0000-4000-8000-0000000000a1"
const ORG = "00000000-0000-4000-8000-0000000000b1"
const MODEL = "claude-opus-5-5"
const MIN = 60_000
const LIMIT_TEXT = "Not delivered: synthetic notice. The limit of 10 times has been reached"
// 要対応の種類（⑩）の確認用の目印。wrap_up の recap・ボタンの文と、要約の status_detail に入れ、どの応答にも出ないことを確かめる
const WRAP_UP_MARK = "WRAPUP-TEXT-SYNTHETIC-MARK"
const STATUS_DETAIL_MARK = "STATUS-DETAIL-SYNTHETIC-MARK"

const sid = (n) => `local_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const cli = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`
const GROUP_A = "cg-00000000-0000-4000-8000-000000000101"
const GROUP_B = "cg-00000000-0000-4000-8000-000000000102"

/**
 * セッション番号。1〜5が試験グループ、6〜7が別グループ。
 * 試験グループの子は、作成順（03→01→04→02）と名前順（01→02→03→04）が食い違うように作ってある（並び順の確認用）。
 */
const S = {
  leaderA: 101,
  screen: 102,
  report: 103,
  verify: 104,
  docs: 105,
  // 3層目など（親は spawnedFrom で指す）
  helperB: 106, // 画面の修正の子。やりとりあり。グループの外
  deepA: 107, // 上の子が作ったもの（4層目）。画面の修正の下にまとめて出る
  subC: 108, // 検証の子。グループ内
  practiceD: 109, // 文書の整備の子。やりとりなし。作業中
  adhoc: 110, // 指揮役が作った。グループの外（2層目に出る）
  stray: 111, // 親が見つからない。グループの外（出ない）
  archived: 112, // 画面の修正の子。アーカイブ済み（出ない）
  sideChat: 113, // 画面の修正から開いたサイドチャット（カードにならない）
  leaderB: 201,
  research: 202,
  sideB: 203, // 調査の子。グループの外（別グループの3層目に出る）
  // 整理ページ（⑦）の確認用。どのグループにも入っていない、判断待ちのセッション
  askUser: 301, // ユーザーへの質問の回答待ち（要対応）
  blockedSummary: 302, // ターン後の要約が「要対応」（内容の先頭60文字が出る）
  errored: 303, // エラーで止まっている
  unreachable: 304, // 宛先の見つからない送信がある
  // 要対応の種類（⑩）の確認用。どれもグループ外で、コンテキストは小さい（整理の候補にならない）
  permission: 305, // 要約の言葉「許可」→ 許可待ち（推定）
  wrapCommit: 306, // wrap_up の質問と commit のボタン → 承認待ち
  wrapAsk: 307, // wrap_up の質問 → 判断待ち
  wrapStandby: 308, // wrap_up に質問が無い → 待機（要対応に数えない）
  wordStandby: 309, // 要約の言葉「届いたら」→ 待機（推定）
  decideCommit: 310, // 要約に「決めて」と「commit」→ 判断待ち（推定。言葉の優先の順の確認）
  planApproval: 311, // ExitPlanMode で止まっている → 承認待ち
  unknownKind: 312, // 要約の言葉からも決められない → 要対応（種類不明）
}

/**
 * parent: そのセッションを作ったセッション（Desktopのメタデータの spawnedFrom.sessionId）。archived: アーカイブ済み。
 * sideChat: サイドチャット（spawnedFrom の btw と userFork が true）。作業用の子は sideSession だけが true。
 * group が無いセッションは、どのグループにも入っていない。
 * 3層目の名前も、作成順（B→A）と名前順（A→B）が食い違うように作ってある。
 */
const SESSIONS = [
  { n: S.leaderA, title: "00_リーダー_試験", group: GROUP_A, createdAgo: 600 },
  { n: S.screen, title: "01_画面の修正", group: GROUP_A, createdAgo: 580 },
  { n: S.report, title: "02_集計の作成", group: GROUP_A, createdAgo: 560 },
  { n: S.verify, title: "03_検証", group: GROUP_A, createdAgo: 590 },
  { n: S.docs, title: "04_文書の整備", group: GROUP_A, createdAgo: 570 },
  { n: S.helperB, title: "補助B_表記ゆれの点検", createdAgo: 540, parent: S.screen },
  { n: S.deepA, title: "補助A_さらに下の確認", createdAgo: 530, parent: S.helperB },
  { n: S.subC, title: "補助C_件数の再計算", group: GROUP_A, createdAgo: 520, parent: S.verify },
  { n: S.practiceD, title: "補助D_書式の確認相手", createdAgo: 510, parent: S.docs },
  { n: S.adhoc, title: "補助_臨時の調べもの", createdAgo: 300, parent: S.leaderA },
  { n: S.stray, title: "補助_行き先のない作業", createdAgo: 400, parent: 999 },
  { n: S.archived, title: "補助_片づけ済み", createdAgo: 410, parent: S.screen, archived: true },
  { n: S.sideChat, title: "脇の質問_用語の確認", createdAgo: 25, parent: S.screen, sideChat: true },
  { n: S.leaderB, title: "00_リーダー_別", group: GROUP_B, createdAgo: 600 },
  { n: S.research, title: "01_調査", group: GROUP_B, createdAgo: 590 },
  { n: S.sideB, title: "補助_別グループの下調べ", createdAgo: 500, parent: S.research },
  { n: S.askUser, title: "判断_方針の確認待ち", createdAgo: 480 },
  { n: S.blockedSummary, title: "判断_承認待ちの変更", createdAgo: 470, needsAction: "本番への反映を承認してください（合成のデータ）" },
  { n: S.errored, title: "判断_エラーで停止", createdAgo: 460, error: "合成のエラー" },
  { n: S.unreachable, title: "判断_宛先不明の送信", createdAgo: 450 },
  { n: S.permission, title: "判断_書き込みの許可", createdAgo: 440, needsAction: "ファイルを書き込む許可をください（合成のデータ）" },
  { n: S.wrapCommit, title: "判断_コミットの承認", createdAgo: 430, needsAction: "" },
  { n: S.wrapAsk, title: "判断_案の選択", createdAgo: 420, needsAction: "" },
  { n: S.wrapStandby, title: "判断_報告の待機", createdAgo: 410, needsAction: "次の連絡が来たら実行します（合成のデータ）" },
  { n: S.wordStandby, title: "判断_届いたら続ける", createdAgo: 400, needsAction: "担当の報告が届いたら続けます（合成のデータ）" },
  { n: S.decideCommit, title: "判断_4つの案", createdAgo: 390, needsAction: "4つの案から決めてください。決まったら commit します（合成のデータ）" },
  { n: S.planApproval, title: "判断_プランの承認", createdAgo: 380 },
  { n: S.unknownKind, title: "判断_種類の分からない要対応", createdAgo: 370, needsAction: "画面の表示を見てください（合成のデータ）" },
]

/**
 * options.now: 基準の時刻。options.fiveHourPercent: 利用上限の記録の、最後の5時間の値(既定22。上限ガードの帯の確認では92)
 */
export function makeOrgChartSample(outDir, options = {}) {
  const now = options.now ?? Date.now()
  const fiveHourPercent = options.fiveHourPercent ?? 22
  const rows = new Map(SESSIONS.map((s) => [s.n, []]))
  const at = (agoMin) => new Date(now - agoMin * MIN).toISOString()
  let seq = 0
  const nextId = (prefix) => `${prefix}_${String(++seq).padStart(5, "0")}`

  // 実際の会話ログと同じ形: 定型の前置きの一文 ＋ タグ ＋ 本文 ＋ 末尾の署名の行（送信元）
  const wrapPeer = (tagAttrs, text, senderTitle) =>
    `Another Claude session sent a message:\n<cross-session-message ${tagAttrs}>\n${text}\n\n送信元：${senderTitle}\n</cross-session-message>`
  const peerRow = (toN, fromN, agoMin, text, title) => {
    rows.get(toN).push({
      type: "user",
      timestamp: at(agoMin),
      isSidechain: false,
      isMeta: true,
      origin: { kind: "peer", from: sid(fromN), hostInjected: true },
      message: { role: "user", content: wrapPeer(`from="${sid(fromN)}" name="${title}"`, text, title) },
    })
  }
  const externalRow = (toN, agoMin, text) => {
    rows.get(toN).push({
      type: "user",
      timestamp: at(agoMin),
      isSidechain: false,
      isMeta: true,
      origin: { kind: "peer", from: "uds:\\\\.\\pipe\\synthetic-cli", fromMode: "uds" },
      message: {
        role: "user",
        content: wrapPeer('from="uds:synthetic" from-session="synthetic" from-name="synthetic-cli" from-mode="uds"', text, "synthetic-cli"),
      },
    })
  }
  const humanRow = (n, agoMin, text) => {
    rows.get(n).push({
      type: "user",
      timestamp: at(agoMin),
      isSidechain: false,
      origin: { kind: "human" },
      message: { role: "user", content: text },
    })
  }
  const assistantRow = (n, agoMin, ctx, { tools = [], stop = tools.length > 0 ? "tool_use" : "end_turn" } = {}) => {
    rows.get(n).push({
      type: "assistant",
      timestamp: at(agoMin),
      isSidechain: false,
      uuid: nextId("uuid"),
      message: {
        id: nextId("msg"),
        model: MODEL,
        role: "assistant",
        stop_reason: stop,
        usage: { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: Math.max(0, Math.round(ctx) - 10), cache_creation_input_tokens: 0 },
        content: [
          { type: "text", text: "合成の応答" },
          ...tools.map((t) => ({ type: "tool_use", id: t.id ?? nextId("toolu"), name: t.name, input: t.input ?? {} })),
        ],
      },
    })
  }
  const toolResultRow = (n, agoMin, toolId, text) => {
    rows.get(n).push({
      type: "user",
      timestamp: at(agoMin),
      isSidechain: false,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: [{ type: "text", text }] }] },
    })
  }

  /** 送信ツールで他のセッションへ送る（呼び出しの行）。ctx は応答時点のコンテキスト */
  const sendRow = (n, agoMin, ctx, toN, text) => assistantRow(n, agoMin, ctx, { tools: [{ name: "SendMessage", input: { to: sid(toN), message: text, summary: "合成の送信" } }] })

  /** 子の作業: startAgo から endAgo の間に tools 回のツール呼び出し。最後のコンテキストを返す */
  const work = (n, startAgo, endAgo, tools, ctxStart, ctxPerTool) => {
    let ctx = ctxStart
    for (let i = 0; i < tools; i++) {
      const ago = startAgo + ((endAgo - startAgo) * (i + 1)) / (tools + 1)
      ctx += ctxPerTool
      assistantRow(n, ago, ctx, { tools: [{ name: i % 2 === 0 ? "Bash" : "Read" }] })
    }
    return ctx
  }

  /**
   * 指示1回分: 親の送信 → 子のpeer行（delivered=false なら送信側のみ）→ 作業 → 報告または終了。
   * parent を省くと、子の属するグループの指揮役。parentCtx は、親の送信時点のコンテキスト（省略すると指揮役の式）
   */
  const task = ({ child, parent, parentCtx, ago, text, tools, workMin, ctx, perTool, outcome, delivered = true, extraReportAgo = null }) => {
    const leaderN = parent ?? (SESSIONS.find((s) => s.n === child).group === GROUP_A ? S.leaderA : S.leaderB)
    const leaderTitle = SESSIONS.find((s) => s.n === leaderN).title
    sendRow(leaderN, ago, parentCtx ?? 200_000 + (240 - ago) * 400, child, text)
    if (delivered) peerRow(child, leaderN, ago - 5 / 60, text, leaderTitle)
    if (!delivered) return ctx
    const endAgo = ago - workMin
    const last = work(child, ago - 0.5, endAgo, tools, ctx, perTool)
    if (outcome === "report") {
      sendRow(child, endAgo - 0.1, last, leaderN, "合成の報告")
      peerRow(leaderN, child, endAgo - 0.1 - 4 / 60, "完了しました。確認をお願いします", SESSIONS.find((s) => s.n === child).title)
      assistantRow(child, endAgo - 0.2, last)
      if (extraReportAgo !== null) {
        sendRow(child, extraReportAgo, last, leaderN, "合成の補足の報告")
        peerRow(leaderN, child, extraReportAgo - 4 / 60, "補足です。数値を確認しました", SESSIONS.find((s) => s.n === child).title)
      }
    } else if (outcome === "end") {
      assistantRow(child, endAgo - 0.1, last)
    }
    return last
  }

  // ---- 試験グループ -------------------------------------------------------
  for (const [n, text] of [
    [S.leaderA, "全体の方針を決める"],
    [S.screen, "次の指示を待つ"],
    [S.report, "次の指示を待つ"],
    [S.verify, "次の指示を待つ"],
    [S.docs, "次の指示を待つ"],
    [S.helperB, "次の指示を待つ"],
    [S.deepA, "次の指示を待つ"],
    [S.subC, "次の指示を待つ"],
    [S.practiceD, "書式の確認をお願いします"],
    [S.adhoc, "次の指示を待つ"],
    [S.stray, "次の指示を待つ"],
    [S.archived, "次の指示を待つ"],
    [S.leaderB, "別グループの方針"],
    [S.research, "次の指示を待つ"],
    [S.sideB, "次の指示を待つ"],
    [S.askUser, "方針を相談したい"],
    [S.blockedSummary, "変更を進めてください"],
    [S.errored, "処理を続けてください"],
    [S.unreachable, "別のセッションへ連絡してください"],
    [S.permission, "設定ファイルを直してください"],
    [S.wrapCommit, "変更をまとめてください"],
    [S.wrapAsk, "進め方の案を出してください"],
    [S.wrapStandby, "担当の報告を待ってください"],
    [S.wordStandby, "担当の報告を待ってください"],
    [S.decideCommit, "案を出してください"],
    [S.planApproval, "計画を立ててください"],
    [S.unknownKind, "画面を直してください"],
  ]) {
    humanRow(n, 236, text)
  }
  assistantRow(S.leaderA, 235.5, 200_000)

  // 他グループ・外部からの、指揮役への連絡
  sendRow(S.leaderB, 230, 150_000, S.leaderA, "ファイル配置の確認依頼です")
  peerRow(S.leaderA, S.leaderB, 230 - 5 / 60, "ファイル配置の確認依頼です", SESSIONS.find((s) => s.n === S.leaderB).title)
  externalRow(S.leaderA, 200, "共有フォルダの整理をお願いします")

  let ctxScreen = 150_000
  let ctxReport = 50_000
  let ctxVerify = 850_000
  let ctxDocs = 790_000

  // 1 報告あり（作業12回）
  ctxScreen = task({ child: S.screen, ago: 215, text: "ログイン画面のエラー表示を直してください", tools: 12, workMin: 7, ctx: ctxScreen, perTool: 2_000, outcome: "report" })
  // 1b 3層目: 画面の修正（2層目）が、自分の作った補助のセッション（グループの外）へ指示し、報告を受ける（作業6回）
  task({ child: S.helperB, parent: S.screen, parentCtx: ctxScreen, ago: 200, text: "表記ゆれがないか見てください", tools: 6, workMin: 4, ctx: 60_000, perTool: 1_000, outcome: "report" })
  // 2 報告なしで終了（作業30回）
  ctxReport = task({ child: S.report, ago: 190, text: "週次の数値を集計して表にしてください", tools: 30, workMin: 11, ctx: ctxReport, perTool: 1_500, outcome: "end" })
  // 3 送信側のみ（受け手の記録が無い）
  task({ child: S.docs, ago: 170, text: "手順書の古い箇所を洗い出してください", tools: 0, workMin: 0, ctx: ctxDocs, perTool: 0, outcome: "none", delivered: false })
  // 4 報告あり（作業90回。満杯の82回を超える）。途中で圧縮
  {
    const startAgo = 150
    const workMin = 25
    sendRow(S.leaderA, startAgo, 230_000, S.screen, "テストが落ちている原因を調べてください")
    peerRow(S.screen, S.leaderA, startAgo - 5 / 60, "テストが落ちている原因を調べてください", SESSIONS[0].title)
    let ctx = ctxScreen
    for (let i = 0; i < 90; i++) {
      const ago = startAgo - 0.5 - ((workMin - 0.5) * (i + 1)) / 91
      ctx += 11_000
      if (ctx > 900_000) {
        // 圧縮: 使用量が下がる
        rows.get(S.screen).push({
          type: "system",
          subtype: "compact_boundary",
          timestamp: at(ago),
          compactMetadata: { trigger: "auto", preTokens: Math.round(ctx), postTokens: 120_000 },
        })
        ctx = 120_000
      }
      assistantRow(S.screen, ago, ctx, { tools: [{ name: i % 2 === 0 ? "Bash" : "Read" }] })
    }
    sendRow(S.screen, startAgo - workMin - 0.1, ctx, S.leaderA, "合成の報告")
    peerRow(S.leaderA, S.screen, startAgo - workMin - 0.1 - 4 / 60, "原因を特定しました。修正案を出します", SESSIONS[1].title)
    assistantRow(S.screen, startAgo - workMin - 0.2, ctx)
    ctxScreen = ctx
  }
  // 5 報告なしで終了（作業8回）。この子は、送信の上限で止まっている（10回送って、11回目が届かない）
  {
    const startAgo = 120
    sendRow(S.leaderA, startAgo, 250_000, S.verify, "依存ライブラリの更新を確認してください")
    peerRow(S.verify, S.leaderA, startAgo - 5 / 60, "依存ライブラリの更新を確認してください", SESSIONS[0].title)
    ctxVerify = work(S.verify, startAgo - 0.5, startAgo - 6, 8, ctxVerify, 7_000)
    for (let i = 0; i < 11; i++) {
      const ago = startAgo - 6 - 0.2 * (i + 1)
      const id = nextId("toolu")
      assistantRow(S.verify, ago, ctxVerify, { tools: [{ id, name: "SendMessage", input: { to: "synthetic-target", message: "合成の送信" } }] })
      toolResultRow(S.verify, ago - 0.02, id, i < 10 ? "Delivered to synthetic-target" : LIMIT_TEXT)
    }
    assistantRow(S.verify, startAgo - 9, ctxVerify)
  }
  // 6 報告あり（作業5回）＋同じ窓の2通目の報告（組にならない）
  task({ child: S.report, ago: 90, text: "先週の議論を3行にまとめてください", tools: 5, workMin: 5, ctx: ctxReport, perTool: 1_500, outcome: "report", extraReportAgo: 80 })
  // 7 作業中（報告も終了もまだ。いまもツールを呼んでいる）
  {
    const startAgo = 60
    sendRow(S.leaderA, startAgo, 270_000, S.screen, "リリースノートの下書きを作ってください")
    peerRow(S.screen, S.leaderA, startAgo - 5 / 60, "リリースノートの下書きを作ってください", SESSIONS[0].title)
    ctxScreen = work(S.screen, startAgo - 0.5, 0.3, 40, ctxScreen, 1_000)
    // いまも作業中: 直近（約10秒前）にもツールを呼んでいる
    assistantRow(S.screen, 0.17, ctxScreen + 1_000, { tools: [{ name: "Bash" }] })
  }
  // 8 報告あり（作業3回）。受け手のコンテキストは80%を超える
  ctxDocs = task({ child: S.docs, ago: 30, text: "バックアップの件数を照合してください", tools: 3, workMin: 5, ctx: ctxDocs, perTool: 5_000, outcome: "report" })

  // サイドチャット: 画面の修正から開いた脇の会話（最近のやりとりが1回。整理の候補にならない小ささ）
  humanRow(S.sideChat, 20, "この用語の意味を教えてください")
  assistantRow(S.sideChat, 19.5, 30_000)

  // 3層目で、やりとりが無いもの: 文書の整備の補助のセッションが、人の入力でいまも動いている（指示も報告も無いが、作業中になる）
  work(S.practiceD, 3, 0.2, 6, 80_000, 1_000)
  assistantRow(S.practiceD, 0.1, 87_000, { tools: [{ name: "Bash" }] })

  // ---- 別グループ ---------------------------------------------------------
  task({ child: S.research, ago: 100, text: "競合3社の価格を比べてください", tools: 10, workMin: 5, ctx: 120_000, perTool: 2_000, outcome: "report" })

  // ---- 整理ページ（⑦）用: 判断待ちのセッション（どのグループにも入っていない）-----------------
  // 回答待ち: ユーザーへの質問のツールを呼んだまま止まっている（要対応）
  assistantRow(S.askUser, 150, 60_000, { tools: [{ name: "AskUserQuestion", input: { question: "合成の質問" } }] })
  // 要約が「要対応」: ターンは終わり、Desktopが要対応と分類している（書き出しのときに要約をメタデータへ付ける）
  assistantRow(S.blockedSummary, 100, 70_000)
  // エラー: 最後の応答のあとでエラーが記録されている
  assistantRow(S.errored, 90, 65_000)
  // 宛先の見つからない送信: 届かなかった送信が1件ある
  {
    const id = nextId("toolu")
    assistantRow(S.unreachable, 70, 55_000, { tools: [{ id, name: "SendMessage", input: { to: "synthetic-missing", message: "合成の送信" } }] })
    toolResultRow(S.unreachable, 69.98, id, "No agent named synthetic-missing is reachable")
    assistantRow(S.unreachable, 69.9, 55_000)
  }

  // ---- 要対応の種類（⑩）: どれもグループ外。Desktop は要対応（blocked）と分類している ----------------------
  // wrap_up の呼び出しでターンを終える（呼び出し → 結果の行）。recap・ボタンの文には、応答に出てはいけない目印を入れる
  const wrapUpTurn = (n, agoMin, input) => {
    const id = nextId("toolu")
    assistantRow(n, agoMin, 30_000, { tools: [{ id, name: "mcp__ccd_turn__wrap_up", input: { recap: `合成のまとめ ${WRAP_UP_MARK}`, ...input } }] })
    toolResultRow(n, agoMin - 0.02, id, "ok")
  }
  assistantRow(S.permission, 95, 30_000)
  wrapUpTurn(S.wrapCommit, 85, {
    ask: "この変更をコミットしてよいですか（合成のデータ）",
    actions: [{ label: "コミットする", message: `コミットしてください ${WRAP_UP_MARK}` }, { action: "commit" }],
    blocked: true,
  })
  wrapUpTurn(S.wrapAsk, 80, { ask: "A案とB案のどちらで進めますか（合成のデータ）", blocked: true })
  wrapUpTurn(S.wrapStandby, 75, { blocked: false })
  assistantRow(S.wordStandby, 72, 30_000)
  assistantRow(S.decideCommit, 68, 30_000)
  assistantRow(S.planApproval, 66, 30_000, { tools: [{ name: "ExitPlanMode", input: { plan: "合成のプラン" } }] })
  assistantRow(S.unknownKind, 64, 30_000)

  // ---- 書き出し -----------------------------------------------------------
  const dataDir = path.join(outDir, "data")
  const projectsRoot = path.join(outDir, "projects")
  const usagePath = path.join(outDir, "usage-snapshots.jsonl")
  const sessionsDir = path.join(dataDir, "claude-code-sessions", ACCOUNT, ORG)
  const projectDir = path.join(projectsRoot, "-sample-org-chart")

  // 組織のルール（⑨）。指揮役は、作業フォルダ（出力先の中）と会話ログのフォルダを、それぞれ自分の分だけ持つ
  const LEADERS = {
    [S.leaderA]: { work: path.join(outDir, "work", "leader-a"), projectDir: path.join(projectsRoot, "-sample-org-chart-leader-a") },
    [S.leaderB]: { work: path.join(outDir, "work", "leader-b"), projectDir: path.join(projectsRoot, "-sample-org-chart-leader-b") },
  }
  const cwdOf = (n) => LEADERS[n]?.work ?? `C:\\sample\\org-chart\\${n}`
  const projectDirOf = (n) => LEADERS[n]?.projectDir ?? projectDir
  const globalClaudeMdPath = path.join(outDir, "global", "CLAUDE.md")
  const extraLedgerPath = path.join(outDir, "extras", "ledger.md")
  // 指揮役でないセッションの記憶に入れる目印。公開ファイルに出ないよう、実行のたびに作る
  const privateMarker = `目印-${randomUUID()}`

  const writeOrgRules = async () => {
    const memo = (name, description, type, body) =>
      `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n  modified: "${new Date(now - 3 * 3_600_000).toISOString()}"\n---\n\n${body}\n`
    const files = [
      [
        globalClaudeMdPath,
        [
          "# 指揮役と担当の決まり（合成のデータ）",
          "",
          "## 出力形式",
          "結論から短く書く。",
          "",
          "## セッションの題名",
          "- 担当のセッションは「NN_<目的>」の形にする（例：「05_…」）。",
          "- 指揮役は「00_リーダー_<グループ>」にする。",
          "",
          "## 組織の運用（全グループ共通）",
          "- 報告は台帳に書き、メッセージは知らせだけにする。",
          "- 文書の担当は 04_文書の整備。",
          "- 表の担当は 06_集計の作成（番号の入れ替えの前の名前）。",
          "",
          "<!-- CCD:DISABLED",
          "## 使わなくなった決まり",
          "- 毎朝まとめて報告する。",
          "-->",
          "",
        ].join("\n"),
      ],
      [
        path.join(LEADERS[S.leaderA].work, "CLAUDE.md"),
        ["# 試験グループの決まり（合成のデータ）", "", "## 進め方", "- 集計は 02_集計の作成 に頼む。", "- 検証は 05_検証 に頼む。", ""].join("\n"),
      ],
      [
        path.join(LEADERS[S.leaderA].projectDir, "memory", "MEMORY.md"),
        ["- [体制](team-structure.md) — 担当の分け方", "- [報告の形](report-format.md) — 報告の書き方", "- [消えた記憶](gone.md) — 索引だけが残っている", ""].join("\n"),
      ],
      [
        path.join(LEADERS[S.leaderA].projectDir, "memory", "team-structure.md"),
        memo("team-structure", "試験グループの担当の分け方", "project", "画面は 01_画面の修正、文書は 08_文書の整備 が受け持つ。"),
      ],
      [
        path.join(LEADERS[S.leaderA].projectDir, "memory", "report-format.md"),
        memo("report-format", "報告は結論から3行で書く", "feedback", "報告は結論から3行で書く。"),
      ],
      [
        path.join(LEADERS[S.leaderA].projectDir, "memory", "unindexed-note.md"),
        memo("unindexed-note", "索引に載せ忘れたメモ", "reference", "合成のメモ。"),
      ],
      [path.join(LEADERS[S.leaderB].projectDir, "memory", "MEMORY.md"), "- [調べものの分担](research-split.md) — 分担\n"],
      [
        path.join(LEADERS[S.leaderB].projectDir, "memory", "research-split.md"),
        memo("research-split", "調べものの分担", "project", "調べものは 01_調査 が受け持つ。"),
      ],
      // 指揮役でないセッションの記憶（読まれてはいけない）
      [path.join(projectDir, "memory", "private-note.md"), memo("private-note", privateMarker, "user", privateMarker)],
      [extraLedgerPath, ["# 台帳（合成のデータ）", "", "## 運用のメモ", "- 確認役は、報告の見出しを見張って検証を始める。", ""].join("\n")],
    ]
    for (const [file, content] of files) {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, content, "utf-8")
    }
    await mkdir(LEADERS[S.leaderB].work, { recursive: true })
  }

  const write = async () => {
    await rm(outDir, { recursive: true, force: true })
    await mkdir(sessionsDir, { recursive: true })
    await mkdir(projectDir, { recursive: true })
    for (const leader of Object.values(LEADERS)) await mkdir(leader.projectDir, { recursive: true })
    await writeOrgRules()

    const assignments = Object.fromEntries(SESSIONS.filter((s) => s.group).map((s) => [sid(s.n), s.group]))
    const sections = [
      { id: "pinned", kind: "pinned", name: "ピン留め", order: 0 },
      { id: GROUP_A, kind: "manual", name: "試験グループ", order: 1, members: [] },
      { id: GROUP_B, kind: "manual", name: "別グループ", order: 2, members: [] },
      { id: "sessions", kind: "sessions", name: "セッション", order: 3 },
    ]
    const scope = `${ACCOUNT}/${ORG}`
    await writeFile(
      path.join(dataDir, "claude_desktop_config.json"),
      JSON.stringify({
        preferences: {
          epitaxyPrefs: {
            "dframe-code-sections": { [scope]: { sections } },
            "dframe-group-scopes": {
              [scope]: {
                groups: [
                  { id: GROUP_A, name: "試験グループ" },
                  { id: GROUP_B, name: "別グループ" },
                ],
                assignments,
              },
            },
            "starred-local-code-sessions": [],
          },
        },
      }),
      "utf-8"
    )

    for (const s of SESSIONS) {
      const list = rows.get(s.n)
      list.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      const file = path.join(projectDirOf(s.n), `${cli(s.n)}.jsonl`)
      await writeFile(file, list.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8")
      const last = list.length > 0 ? Date.parse(list[list.length - 1].timestamp) : now
      const lastAssistantUuid = [...list].reverse().find((r) => r.type === "assistant")?.uuid
      await utimes(file, new Date(last), new Date(last))
      await writeFile(
        path.join(sessionsDir, `${sid(s.n)}.json`),
        JSON.stringify({
          sessionId: sid(s.n),
          cliSessionId: cli(s.n),
          cwd: cwdOf(s.n),
          originCwd: cwdOf(s.n),
          createdAt: now - s.createdAgo * MIN,
          lastActivityAt: last,
          model: MODEL,
          effort: "high",
          isArchived: s.archived === true,
          title: s.title,
          permissionMode: "acceptEdits",
          completedTurns: 5,
          // 親(そのセッションを作ったセッション)。実際のDesktopの形式に合わせ、sessionId のほかの項目も付ける(取り込まれない)。
          // sideSession は作業用の子にもサイドチャットにも付く。サイドチャットだけ btw と userFork が true
          ...(s.parent
            ? {
                spawnedFrom: {
                  sessionId: sid(s.parent),
                  taskId: "synthetic-task",
                  title: "synthetic",
                  sideSession: true,
                  ...(s.sideChat ? { btw: true, userFork: true } : {}),
                },
              }
            : {}),
          // ターン後の要約が「要対応」(最後の応答に対応する要約)。内容の先頭60文字が、整理ページに出る
          ...(s.needsAction !== undefined
            ? {
                // status_detail は分類の言葉の推定にだけ使い、応答には出ない（⑩。目印で確かめる）
                postTurnSummary: { status_category: "blocked", status_detail: `合成の詳細 ${STATUS_DETAIL_MARK}`, needs_action: s.needsAction, summarizes_uuid: lastAssistantUuid },
                postTurnSummaryFor: lastAssistantUuid,
                lastAssistantUuid,
              }
            : {}),
          // エラーの記録(最後の活動より後)
          ...(s.error ? { error: s.error, errorAt: last + 1_000 } : {}),
        }),
        "utf-8"
      )
    }

    // 利用上限の公式値の記録(指揮役の運用が get_usage の値を追記する形)。2時間前と2分前の2件
    const fiveHourReset = now + 177 * MIN
    const weeklyReset = now + 4 * 24 * 60 * MIN
    const snapshot = (agoMin, fiveHour, weekly) =>
      JSON.stringify({
        ts: at(agoMin),
        source: "get_usage",
        recordedBy: "synthetic-recorder",
        plan: "Max",
        windows: [
          { key: "five_hour", label: "5-hour limit", percentUsed: fiveHour, resetsAt: new Date(fiveHourReset).toISOString() },
          { key: "weekly_all", label: "Weekly · all models", percentUsed: weekly, resetsAt: new Date(weeklyReset).toISOString() },
        ],
        extraUsage: { enabled: false, spent: null },
      })
    await writeFile(usagePath, [snapshot(120, 5, 12), snapshot(2, fiveHourPercent, 14)].join("\n") + "\n", "utf-8")
  }

  return {
    dataDir,
    projectsRoot,
    usagePath,
    /** 組織のルール（⑨）の設定ファイル config/org-rules.json に書く内容 */
    orgRulesConfig: { globalClaudeMdPath, extraFiles: [{ label: "台帳（合成のデータ）", path: extraLedgerPath }] },
    write,
    groups: { a: GROUP_A, b: GROUP_B },
    ids: Object.fromEntries(Object.entries(S).map(([k, n]) => [k, sid(n)])),
    /** セッションID → 会話ログのファイル(指揮役は自分のフォルダ、それ以外は -sample-org-chart) */
    transcriptPaths: Object.fromEntries(Object.values(S).map((n) => [sid(n), path.join(projectDirOf(n), `${cli(n)}.jsonl`)])),
    /** この合成データでの、出来事の期待値(直近4時間) */
    expected: {
      // セッション一覧の API が返すセッションの数(アーカイブ済み・サイドチャットを含む)。撮影の前の確認(scripts/check-sample-server.mjs)で使う
      sessionCount: Object.keys(S).length,
      // 同じく、セッションの ID の一覧。件数がたまたま同じ別のデータ(本物を含む)を、合成データと見誤らないために照らし合わせる
      sessionIds: Object.values(S).map(sid).sort(),
      // 組織のルール（⑨）の期待値。privateMarker は、指揮役でないセッションの記憶の中身(どの応答・画面にも出てはいけない)
      orgRules: {
        folderCount: 2,
        globalSectionOrder: ["組織の運用（全グループ共通）", "セッションの題名", "出力形式", "使わなくなった決まり"],
        // 全体の決まり 06_集計の作成・試験グループの CLAUDE.md 05_検証・記憶 08_文書の整備
        staleTotal: 3,
        staleRefs: ["06_集計の作成", "05_検証", "08_文書の整備"],
        memoryCounts: { [sid(S.leaderA)]: 3, [sid(S.leaderB)]: 1 },
        notInIndex: ["unindexed-note.md"],
        missingFromDisk: ["gone.md"],
        privateMarker,
      },
      groupA: {
        leader: sid(S.leaderA),
        // 指示・報告の数は、3層目の親子の分を含む（指揮役自身の分は、leaderInstructs・leaderReports）
        instructs: 9,
        confirmed: 8,
        senderOnly: 1,
        reports: 6,
        pairedReports: 5,
        leaderInstructs: 8,
        leaderReports: 5,
        // 作業量は、指示から報告（終了）までのツール呼び出しの回数。報告の送信そのものも1回に数える
        // （報告なしで終了した検証の子は、作業8回に、上限まで送った11回の送信を足した19回）。時刻の順
        pairedTools: [13, 7, 91, 6, 4],
        ends: 2,
        endTools: [30, 19],
        crossOtherGroup: 1,
        crossExternal: 1,
        compacts: 1,
        workingChild: sid(S.screen),
        stoppedBySendLimit: sid(S.verify),
        // 木: セッション → [層, 親]。ここに無いもの(親が見つからない・アーカイブ済み)は出ない
        tree: {
          [sid(S.screen)]: [2, sid(S.leaderA)],
          [sid(S.report)]: [2, sid(S.leaderA)],
          [sid(S.verify)]: [2, sid(S.leaderA)],
          [sid(S.docs)]: [2, sid(S.leaderA)],
          [sid(S.adhoc)]: [2, sid(S.leaderA)],
          [sid(S.helperB)]: [3, sid(S.screen)],
          [sid(S.deepA)]: [3, sid(S.screen)],
          [sid(S.subC)]: [3, sid(S.verify)],
          [sid(S.practiceD)]: [3, sid(S.docs)],
        },
        notInTree: [sid(S.stray), sid(S.archived), sid(S.sideChat)],
        // サイドチャット: [親, 数]。カードにはならず、親のカードに数だけ出る
        sideChats: [[sid(S.screen), 1]],
        subWorking: sid(S.practiceD),
      },
      // 整理ページ（⑦）の期待値（現在時刻を基準にした、この合成データでの結果）。ID の並びは、画面の並び順
      housekeeping: {
        // コンテキスト整理の候補: [セッション, 理由, キャッシュ]。再開コスト（コンテキスト量×単価）の大きい順で、キャッシュが有効なものは最後
        cleanup: [
          [sid(S.verify), ["large", "idle"], "expired"],
          [sid(S.leaderB), ["idle"], "expired"],
          [sid(S.research), ["idle"], "expired"],
          [sid(S.report), ["idle"], "expired"],
          [sid(S.blockedSummary), ["idle"], "expired"],
          [sid(S.helperB), ["idle"], "expired"],
          [sid(S.errored), ["idle"], "expired"],
          [sid(S.askUser), ["idle"], "expired"],
          [sid(S.unreachable), ["idle"], "expired"],
          [sid(S.docs), ["large"], "valid"],
        ],
        // 返事の来ていない指示（古い指示から）: [種類, 送り手, 宛先, 作業中]
        unanswered: [
          ["ended-without-report", sid(S.leaderA), sid(S.report), false],
          ["possibly-undelivered", sid(S.leaderA), sid(S.docs), false],
          ["ended-without-report", sid(S.leaderA), sid(S.verify), false],
          ["awaiting-report", sid(S.leaderA), sid(S.screen), true],
        ],
        // 判断待ち: [セッション, 理由]。許可待ち → 承認待ち → 判断待ち（種類不明を含む）→ 送信上限 → エラー → 届かなかった送信（⑩）。
        // 同じ区分の中は、最後の活動が古い順。待機（wrapStandby・wordStandby）は入らない
        decisions: [
          [sid(S.permission), ["needs-action"]],
          [sid(S.blockedSummary), ["needs-action"]],
          [sid(S.wrapCommit), ["needs-action"]],
          [sid(S.planApproval), ["needs-action"]],
          [sid(S.askUser), ["needs-action"]],
          [sid(S.wrapAsk), ["needs-action"]],
          [sid(S.decideCommit), ["needs-action"]],
          [sid(S.unknownKind), ["needs-action"]],
          [sid(S.verify), ["send-limit"]],
          [sid(S.errored), ["error"]],
          [sid(S.unreachable), ["undelivered"]],
        ],
      },
      // 要対応の種類（⑩）の期待値: セッション → [種類, 手がかり, 推定か]。standby は待機（要対応ではない）
      needsAction: {
        kinds: {
          [sid(S.permission)]: ["permission", "summary-words", true],
          [sid(S.blockedSummary)]: ["approval", "summary-words", true],
          [sid(S.wrapCommit)]: ["approval", "wrap-up-action", false],
          [sid(S.planApproval)]: ["approval", "plan-tool", false],
          [sid(S.askUser)]: ["decision", "ask-tool", false],
          [sid(S.wrapAsk)]: ["decision", "wrap-up-ask", false],
          [sid(S.decideCommit)]: ["decision", "summary-words", true],
          [sid(S.unknownKind)]: ["unknown", "none", false],
        },
        standby: [sid(S.wrapStandby), sid(S.wordStandby)].sort(),
        // 要約に要対応の文が無いものは、wrap_up の質問の先頭60文字が出る
        askExcerpts: {
          [sid(S.wrapCommit)]: "この変更をコミットしてよいですか（合成のデータ）",
          [sid(S.wrapAsk)]: "A案とB案のどちらで進めますか（合成のデータ）",
        },
        // ホームの「判断待ち」の数（整理ページと同じ）
        decisionCount: 11,
        marks: [WRAP_UP_MARK, STATUS_DETAIL_MARK],
      },
      groupB: {
        leader: sid(S.leaderB),
        instructs: 1,
        confirmed: 1,
        senderOnly: 0,
        reports: 1,
        pairedReports: 1,
        ends: 0,
        tree: { [sid(S.research)]: [2, sid(S.leaderB)], [sid(S.sideB)]: [3, sid(S.research)] },
      },
    },
  }
}

/**
 * 送信上限で止まっている子（03_検証）の会話ログに、作業中の人の入力を1行追記する。
 * セッションが作業中のときの人の入力は、user の行ではなく、attachment（queued_command・origin が human）の行として記録される。
 * 追記すると、その子の「送信 10/10」が0に戻り、「送信上限で停止中」が消える。
 */
export async function appendWorkingHumanInput(projectsRoot, { now = Date.now() } = {}) {
  const row = {
    type: "attachment",
    timestamp: new Date(now).toISOString(),
    isSidechain: false,
    attachment: { type: "queued_command", prompt: "続けてください（作業中の人の入力）", commandMode: "prompt", origin: { kind: "human" } },
  }
  const file = path.join(projectsRoot, "-sample-org-chart", `${cli(S.verify)}.jsonl`)
  await appendFile(file, JSON.stringify(row) + "\n", "utf-8")
  return file
}

async function main() {
  if (process.argv[2] === "--append-human-input") {
    const root = process.argv[3]
    if (!root) {
      console.error("使い方: node scripts/make-org-chart-sample.mjs --append-human-input <合成データの出力先のフォルダ>")
      process.exit(1)
    }
    await appendWorkingHumanInput(path.join(path.resolve(root), "projects"))
    console.log("作業中の人の入力を、止まっている子（03_検証）の会話ログに追記しました")
    return
  }
  const guard = process.argv[2] === "--guard"
  const out = process.argv[guard ? 3 : 2]
  if (!out) {
    console.error("使い方: node scripts/make-org-chart-sample.mjs [--guard] <出力先のフォルダ>")
    process.exit(1)
  }
  const outDir = path.resolve(out)
  const sample = makeOrgChartSample(outDir, guard ? { fiveHourPercent: 92 } : {})
  await sample.write()
  await writeFile(path.join(outDir, "expected.json"), JSON.stringify(sample.expected, null, 2) + "\n", "utf-8")
  console.log(`合成データを作りました: ${outDir}`)
  console.log("config/desktop-sessions.json に、次の内容を書いてください（パスは絶対パス）:")
  console.log(JSON.stringify({ dataDir: sample.dataDir, projectsRoot: sample.projectsRoot }, null, 2))
  console.log("利用上限のゲージも見るときは、config/usage.json に、次の内容を書いてください:")
  console.log(JSON.stringify({ snapshotsPath: sample.usagePath, projectsRoot: sample.projectsRoot }, null, 2))
  console.log("組織のルールのページも見るときは、config/org-rules.json に、次の内容を書いてください:")
  console.log(JSON.stringify(sample.orgRulesConfig, null, 2))
  // 目印の文字列は画面に出さない(expected.json にだけ書く)
  const orgRulesShown = { ...sample.expected.orgRules }
  delete orgRulesShown.privateMarker
  console.log("期待値（直近4時間）:", JSON.stringify({ ...sample.expected, orgRules: orgRulesShown }))
  console.log("サーバーは、本物のデータを自動で探さないよう、環境変数 CCD_DESKTOP_AUTODETECT=0 を付けて起動してください（PowerShell の例）:")
  console.log("  $env:CCD_DESKTOP_AUTODETECT='0'; $env:CCD_DATA_DIR='<config フォルダの親>'; npx next start -H 127.0.0.1 -p 3961")
  console.log(`撮る前に確かめる: node scripts/check-sample-server.mjs http://127.0.0.1:3961 ${outDir}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main()
}
