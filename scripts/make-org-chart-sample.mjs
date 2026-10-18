/**
 * 組織図（/desktop-sessions の「組織図」）の動作確認用に、合成（架空）の Claude Desktop データを作る。
 * 実際のセッション名・ID・指示の文面は含まない。現在時刻を基準に、直近4時間の出来事を作るので、
 * 画面を開く直前に実行する（古くなったら作り直す）。
 *
 * 使い方:
 *   node scripts/make-org-chart-sample.mjs <出力先のフォルダ>
 *   node scripts/make-org-chart-sample.mjs --append-human-input <出力先のフォルダ>   (止まっている子へ、作業中の人の入力を追記)
 * 出力先に data/（Desktopのデータ）と projects/（会話ログ）ができる。表示される設定を、
 * config/desktop-sessions.json に書いて開発サーバーを起動する。
 *
 * 作るもの（グループ「試験グループ」と「別グループ」）:
 *   試験グループ: 指揮役1・子4。指示8（うち送信側のみ1）・報告5（うち組にならないもの1）・報告なしで終了2・
 *                 他グループからの連絡1・外部（CLI）からの連絡1・圧縮1・作業中の子1・コンテキスト80%超と90%超・
 *                 送信上限で停止中の子1・作業量が満杯（82回）を超える指示1
 *                 3層目（子が作った補助のセッション）: 指示・報告のやりとりがあるもの（グループの外）1・
 *                 4層目（3層目が作ったもの。2層目の祖先の下にまとめて出る）1・グループ内の子が作ったもの1・
 *                 やりとりが無くて作業中のもの1。指揮役が作ったグループ外のセッション（2層目に出る）1。
 *                 木に出ないもの: 親が見つからないグループ外のセッション1・アーカイブ済み1
 *   別グループ:   指揮役1・子1。指示1・報告1。子が作ったグループ外のセッション1（3層目に出る）
 */
import { appendFile, mkdir, rm, writeFile, utimes } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ACCOUNT = "00000000-0000-4000-8000-0000000000a1"
const ORG = "00000000-0000-4000-8000-0000000000b1"
const MODEL = "claude-opus-5-5"
const MIN = 60_000
const LIMIT_TEXT = "Not delivered: synthetic notice. The limit of 10 times has been reached"

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
  leaderB: 201,
  research: 202,
  sideB: 203, // 調査の子。グループの外（別グループの3層目に出る）
}

/**
 * parent: そのセッションを作ったセッション（Desktopのメタデータの spawnedFrom.sessionId）。archived: アーカイブ済み。
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
  { n: S.leaderB, title: "00_リーダー_別", group: GROUP_B, createdAgo: 600 },
  { n: S.research, title: "01_調査", group: GROUP_B, createdAgo: 590 },
  { n: S.sideB, title: "補助_別グループの下調べ", createdAgo: 500, parent: S.research },
]

export function makeOrgChartSample(outDir, options = {}) {
  const now = options.now ?? Date.now()
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
    [S.screen, "待機"],
    [S.report, "待機"],
    [S.verify, "待機"],
    [S.docs, "待機"],
    [S.helperB, "待機"],
    [S.deepA, "待機"],
    [S.subC, "待機"],
    [S.practiceD, "書式の確認をお願いします"],
    [S.adhoc, "待機"],
    [S.stray, "待機"],
    [S.archived, "待機"],
    [S.leaderB, "別グループの方針"],
    [S.research, "待機"],
    [S.sideB, "待機"],
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

  // 3層目で、やりとりが無いもの: 文書の整備の補助のセッションが、人の入力でいまも動いている（指示も報告も無いが、作業中になる）
  work(S.practiceD, 3, 0.2, 6, 80_000, 1_000)
  assistantRow(S.practiceD, 0.1, 87_000, { tools: [{ name: "Bash" }] })

  // ---- 別グループ ---------------------------------------------------------
  task({ child: S.research, ago: 100, text: "競合3社の価格を比べてください", tools: 10, workMin: 5, ctx: 120_000, perTool: 2_000, outcome: "report" })

  // ---- 書き出し -----------------------------------------------------------
  const dataDir = path.join(outDir, "data")
  const projectsRoot = path.join(outDir, "projects")
  const sessionsDir = path.join(dataDir, "claude-code-sessions", ACCOUNT, ORG)
  const projectDir = path.join(projectsRoot, "-sample-org-chart")

  const write = async () => {
    await rm(outDir, { recursive: true, force: true })
    await mkdir(sessionsDir, { recursive: true })
    await mkdir(projectDir, { recursive: true })

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
      const file = path.join(projectDir, `${cli(s.n)}.jsonl`)
      await writeFile(file, list.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8")
      const last = list.length > 0 ? Date.parse(list[list.length - 1].timestamp) : now
      await utimes(file, new Date(last), new Date(last))
      await writeFile(
        path.join(sessionsDir, `${sid(s.n)}.json`),
        JSON.stringify({
          sessionId: sid(s.n),
          cliSessionId: cli(s.n),
          cwd: `C:\\sample\\org-chart\\${s.n}`,
          originCwd: `C:\\sample\\org-chart\\${s.n}`,
          createdAt: now - s.createdAgo * MIN,
          lastActivityAt: last,
          model: MODEL,
          effort: "high",
          isArchived: s.archived === true,
          title: s.title,
          permissionMode: "acceptEdits",
          completedTurns: 5,
          // 親(そのセッションを作ったセッション)。実際のDesktopの形式に合わせ、sessionId のほかの項目も付ける(取り込まれない)
          ...(s.parent ? { spawnedFrom: { sessionId: sid(s.parent), taskId: "synthetic-task", title: "synthetic" }, sideSession: true } : {}),
        }),
        "utf-8"
      )
    }
  }

  return {
    dataDir,
    projectsRoot,
    write,
    groups: { a: GROUP_A, b: GROUP_B },
    ids: Object.fromEntries(Object.entries(S).map(([k, n]) => [k, sid(n)])),
    /** この合成データでの、出来事の期待値(直近4時間) */
    expected: {
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
        notInTree: [sid(S.stray), sid(S.archived)],
        subWorking: sid(S.practiceD),
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
  const out = process.argv[2]
  if (!out) {
    console.error("使い方: node scripts/make-org-chart-sample.mjs <出力先のフォルダ>")
    process.exit(1)
  }
  const outDir = path.resolve(out)
  const sample = makeOrgChartSample(outDir)
  await sample.write()
  console.log(`合成データを作りました: ${outDir}`)
  console.log("config/desktop-sessions.json に、次の内容を書いてください（パスは絶対パス）:")
  console.log(JSON.stringify({ dataDir: sample.dataDir, projectsRoot: sample.projectsRoot }, null, 2))
  console.log("期待値（直近4時間）:", JSON.stringify(sample.expected))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main()
}
