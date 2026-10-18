import { SessionDiagnosisMetrics, SessionSummary } from "./types"

/**
 * 生の計測値だけでは「その数字が良いのか悪いのか」が判断できないため、
 * セッションの寿命・エラー率・読み取り精度など8つの読み取り観点を、
 * しきい値付きの判定と具体的なアクションに変換する。
 *
 * ここはCPUモードで完結する純粋関数として実装する（LLM呼び出しは行わない）。
 * しきい値は「経験則に基づく初期値」であり絶対的な正解ではないため、
 * 判定理由（criteria）を必ずUIに出して、ユーザー自身が妥当性を判断できるようにする。
 */

export type DiagnosisSeverity = "good" | "warning" | "critical" | "info"

/** 同一プロジェクト内の他セッションと突き合わせた相対評価 */
export interface DiagnosisComparison {
  /** このセッションの値 */
  current: number
  /** 他セッション（このセッションを除く）の中央値 */
  median: number
  /** 比較対象にした他セッションの件数 */
  sampleSize: number
  /** 値が大きいほど良い指標か（キャッシュヒット率など） */
  higherIsBetter: boolean
}

export interface SessionDiagnosis {
  id: string
  /** 診断軸の名前 */
  title: string
  severity: DiagnosisSeverity
  /** 判定根拠になった実測値の表示文字列 */
  value: string
  /** この数字が何を意味するか */
  meaning: string
  /** 次に取るべき具体的な行動。問題がなければnull */
  action: string | null
  /** なぜこの判定になったかのしきい値説明 */
  criteria: string
  comparison: DiagnosisComparison | null
}

export interface SessionHealthReport {
  /** 各軸のうち最も重い判定 */
  overall: DiagnosisSeverity
  /** 総合判定の一言サマリー */
  headline: string
  /** 今すぐ効果が大きい対処（重い順、最大3件）。無ければ空配列 */
  topActions: string[]
  diagnoses: SessionDiagnosis[]
}

const SEVERITY_RANK: Record<DiagnosisSeverity, number> = {
  good: 0,
  info: 0,
  warning: 1,
  critical: 2,
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** 0除算を避けつつ比率を求める。分母が0なら0を返す */
function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

export function toolErrorRate(s: Pick<SessionSummary, "toolErrorCount" | "toolCallCount">): number {
  return ratio(s.toolErrorCount, s.toolCallCount) * 100
}

export function cacheHitRate(
  s: Pick<SessionSummary, "totalCacheReadTokens" | "totalCacheCreationTokens">
): number | null {
  const total = s.totalCacheReadTokens + s.totalCacheCreationTokens
  if (total === 0) return null
  return (s.totalCacheReadTokens / total) * 100
}

export function avgOutputCharsPerCall(
  s: Pick<SessionSummary, "totalToolOutputChars" | "toolCallCount">
): number {
  return ratio(s.totalToolOutputChars, s.toolCallCount)
}

export function turnsPerUserMessage(
  s: Pick<SessionSummary, "turnCount" | "userMessageCount">
): number {
  return ratio(s.turnCount, s.userMessageCount)
}

/**
 * 比較用の中央値を作る。母数が少ないと中央値が偶然に振られて誤った安心・不安を与えるため、
 * 他セッションが2件未満のときは比較自体を出さない（nullを返す）。
 */
function buildComparison(
  current: number,
  others: number[],
  higherIsBetter: boolean
): DiagnosisComparison | null {
  if (others.length < 2) return null
  return { current, median: median(others), sampleSize: others.length, higherIsBetter }
}

function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function formatChars(chars: number): string {
  if (chars >= 10000) return `${(chars / 10000).toFixed(1)}万文字`
  return `${formatNumber(Math.round(chars))}文字`
}

/**
 * 1セッションを8つの観点で診断する。
 * @param metrics 対象セッションの計測値
 * @param otherSessions 同一プロジェクト内の他セッション（比較の母集団。空でも動作する）
 */
export function diagnoseSession(
  metrics: SessionDiagnosisMetrics,
  otherSessions: SessionSummary[] = []
): SessionHealthReport {
  const s = metrics.summary
  const others = otherSessions.filter((o) => o.sessionId !== s.sessionId)
  const diagnoses: SessionDiagnosis[] = [
    diagnoseLifespan(s, others),
    diagnoseErrorLoop(s, others),
    diagnoseReadPrecision(s, others),
    diagnoseCache(s, others),
    diagnoseHooks(s),
    diagnoseSubagent(s),
    diagnoseMcp(s, metrics),
    diagnoseAutonomy(s, others),
  ]

  const overall = diagnoses.reduce<DiagnosisSeverity>((worst, d) => {
    return SEVERITY_RANK[d.severity] > SEVERITY_RANK[worst] ? d.severity : worst
  }, "good")

  const topActions = diagnoses
    .filter((d) => d.action !== null && SEVERITY_RANK[d.severity] > 0)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, 3)
    .map((d) => `【${d.title}】${d.action}`)

  const criticalCount = diagnoses.filter((d) => d.severity === "critical").length
  const warningCount = diagnoses.filter((d) => d.severity === "warning").length

  let headline: string
  if (criticalCount > 0) {
    headline = `${criticalCount}件の要対処があります。下の「今すぐ効く対処」から着手してください。`
  } else if (warningCount > 0) {
    headline = `${warningCount}件の注意点があります。作業を続けても問題ありませんが、目を通しておくと効率が上がります。`
  } else {
    headline = "問題は見つかりませんでした。このまま作業を続けて問題ありません。"
  }

  return { overall, headline, topActions, diagnoses }
}

/** 1. セッションの寿命と記憶喪失の管理 */
function diagnoseLifespan(s: SessionSummary, others: SessionSummary[]): SessionDiagnosis {
  const count = s.compactionCount
  const severity: DiagnosisSeverity = count === 0 ? "good" : count === 1 ? "warning" : "critical"

  const meaning =
    count === 0
      ? "コンテキスト（Claudeが一度に覚えていられる情報量）はまだ上限に達していません。セッション開始時の指示も保持されています。"
      : count === 1
        ? "コンテキストが上限に達し、古い会話が1度要約・圧縮されています。それ以前に伝えた細かい指示やコードの文脈は、Claudeが忘れている可能性があります。"
        : `コンテキストが${count}回圧縮されています。このセッションは実質的に寿命で、序盤の文脈はほぼ失われていると考えてください。`

  const action =
    count === 0
      ? null
      : count === 1
        ? "この先も同じ前提で作業を続けるなら、重要な決定事項をCLAUDE.mdに書いて毎回読ませるようにすると、圧縮されても失われません。"
        : "/clear で履歴をリセットするか、新しいセッションを開いて作業し直してください。長い作業は分割し、決定事項はCLAUDE.mdに残すのが有効です。"

  return {
    id: "lifespan",
    title: "セッションの寿命",
    severity,
    value: `${count}回`,
    meaning,
    action,
    criteria: "0回=良好 / 1回=注意 / 2回以上=要対処",
    comparison: buildComparison(count, others.map((o) => o.compactionCount), false),
  }
}

/** 2. AIがハマっている「沼（無限ループ）」の検知 */
function diagnoseErrorLoop(s: SessionSummary, others: SessionSummary[]): SessionDiagnosis {
  const rate = toolErrorRate(s)
  const severity: DiagnosisSeverity = rate < 5 ? "good" : rate < 15 ? "warning" : "critical"

  const meaning =
    severity === "good"
      ? `ツール実行${formatNumber(s.toolCallCount)}回のうち失敗は${s.toolErrorCount}回で、想定内の失敗率です。`
      : `ツール実行${formatNumber(s.toolCallCount)}回のうち${s.toolErrorCount}回が失敗しています。環境が整っていないまま、Claudeが同じコマンドを何度も試して失敗し続ける「沼」に入っている可能性があります。`

  const action =
    severity === "good"
      ? null
      : "下の「ツール呼び出し集計」でエラーが集中しているツールを特定し、不足しているライブラリのインストールや権限設定など、環境側を人間が先に直してください。Claude任せにすると同じ失敗を繰り返します。"

  return {
    id: "error-loop",
    title: "無限ループ（沼）の兆候",
    severity,
    value: `${rate.toFixed(1)}%（${s.toolErrorCount}/${formatNumber(s.toolCallCount)}回）`,
    meaning,
    action,
    criteria: "エラー率 5%未満=良好 / 5〜15%=注意 / 15%以上=要対処",
    comparison: buildComparison(rate, others.map(toolErrorRate), false),
  }
}

/** 8. ツールの使い方（読み取りの精度） */
function diagnoseReadPrecision(s: SessionSummary, others: SessionSummary[]): SessionDiagnosis {
  const avg = avgOutputCharsPerCall(s)
  const severity: DiagnosisSeverity = avg < 2000 ? "good" : avg < 5000 ? "warning" : "critical"

  const meaning =
    severity === "good"
      ? `ツール1回あたりの読み取りは平均${formatChars(avg)}です。ファイル全体を丸読みせず、必要な箇所だけを絞って読めています。`
      : `ツール1回あたり平均${formatChars(avg)}を読み込んでいます。巨大なログやファイルを丸ごと読ませている可能性が高く、コンテキストを急速に消費します。`

  const action =
    severity === "good"
      ? null
      : "「grepで該当行だけ絞って読んで」「ファイルの先頭100行だけ見て」のように読み取り範囲を限定する指示に変えると、コンテキスト消費とコンパクション頻度を大きく減らせます。"

  return {
    id: "read-precision",
    title: "読み取りの精度",
    severity,
    value: `平均${formatChars(avg)}/回`,
    meaning,
    action,
    criteria: "1回あたり 2,000文字未満=良好 / 2,000〜5,000文字=注意 / 5,000文字以上=要対処",
    comparison: buildComparison(avg, others.map(avgOutputCharsPerCall), false),
  }
}

/** 3. コストと応答速度の最適化 */
function diagnoseCache(s: SessionSummary, others: SessionSummary[]): SessionDiagnosis {
  const rate = cacheHitRate(s)
  const totalTokens = s.totalInputTokens + s.totalOutputTokens

  if (rate === null) {
    return {
      id: "cache",
      title: "コストと応答速度",
      severity: "info",
      value: "—",
      meaning: "キャッシュの記録がないため判定できません（セッションが短すぎる場合に起こります）。",
      action: null,
      criteria: "ヒット率 90%以上=良好 / 70〜90%=注意 / 70%未満=要対処",
      comparison: null,
    }
  }

  const severity: DiagnosisSeverity = rate >= 90 ? "good" : rate >= 70 ? "warning" : "critical"

  const meaning =
    severity === "good"
      ? `キャッシュヒット率${rate.toFixed(0)}%。累計${formatNumber(totalTokens)}トークンを消費していますが、大半がキャッシュから読まれているため課金額・待ち時間ともに大きく抑えられています。`
      : `キャッシュヒット率${rate.toFixed(0)}%。同じ文脈を何度も作り直しており、その分だけ課金額と応答待ちが増えています。`

  const action =
    severity === "good"
      ? null
      : "コンテキストを細かく切りすぎていないか見直してください。キャッシュが貯まる前に /clear を繰り返したり、大きなファイルを毎回読み直したりすると、ヒット率が下がって無駄なAPI料金が発生します。"

  return {
    id: "cache",
    title: "コストと応答速度",
    severity,
    value: `${rate.toFixed(0)}%`,
    meaning,
    action,
    criteria: "ヒット率 90%以上=良好 / 70〜90%=注意 / 70%未満=要対処",
    comparison: buildComparison(
      rate,
      others.map(cacheHitRate).filter((r): r is number => r !== null),
      true
    ),
  }
}

/** 6. 開発ワークフローの安定性 */
function diagnoseHooks(s: SessionSummary): SessionDiagnosis {
  const count = s.hookErrorCount
  const severity: DiagnosisSeverity = count === 0 ? "good" : "warning"

  return {
    id: "hooks",
    title: "ワークフローの安定性",
    severity,
    value: `${count}回`,
    meaning:
      count === 0
        ? "コミット前のリンターやフォーマッタなど、自動実行されるフックが一度も失敗していません。開発環境が整っている状態です。"
        : `フックが${count}回失敗しています。「Claudeがコードを書く→フックに弾かれる→直そうとしてまた弾かれる」という悪循環に陥りやすい状態です。`,
    action:
      count === 0
        ? null
        : "失敗しているフック（pre-commitやフォーマッタ）の設定を人間が先に直してください。Claudeに直させようとすると、フック起因の失敗をコード側の問題と誤認して沼にはまります。",
    criteria: "0回=良好 / 1回以上=注意",
    comparison: null,
  }
}

/** 7. 「単独処理」か「チーム分業」か */
function diagnoseSubagent(s: SessionSummary): SessionDiagnosis {
  const count = s.subagentCallCount
  // サブエージェント未使用そのものは問題ではない。コンテキスト圧縮が起きている場合に限り、
  // 「1セッションに抱え込んだこと」が圧縮の一因として効いてくるため注意扱いにする。
  const severity: DiagnosisSeverity = count > 0 ? "good" : s.compactionCount > 0 ? "warning" : "info"

  const meaning =
    count > 0
      ? `サブエージェントを${count}回呼び出し、重い調査などをメインの文脈から切り離せています。`
      : s.compactionCount > 0
        ? `${formatNumber(s.turnCount)}ターンすべてを1つのメインセッションだけで処理しており、コンテキスト圧縮が起きた一因になっている可能性があります。`
        : `${formatNumber(s.turnCount)}ターンすべてを1つのメインセッションで処理しています。今のところ支障は出ていません。`

  const action =
    severity === "warning"
      ? "調査・全文検索・大量ファイルの読み込みなど、結果だけ分かればよい作業はサブエージェント（Agentツール）に切り出してください。読み込んだ中身がメインの文脈を圧迫しなくなり、圧縮を先送りできます。"
      : null

  return {
    id: "subagent",
    title: "作業の分業",
    severity,
    value: `${count}回`,
    meaning,
    action,
    criteria: "1回以上=良好 / 0回かつ圧縮あり=注意 / 0回かつ圧縮なし=情報",
    comparison: null,
  }
}

/** 4. 拡張機能（MCP）の稼働チェック */
function diagnoseMcp(s: SessionSummary, metrics: SessionDiagnosisMetrics): SessionDiagnosis {
  const count = s.mcpToolCallCount
  const serverCount = Object.keys(metrics.mcpCallCountsByServer).length
  // MCPを設定していないユーザーにとって0回は正常なため、警告ではなく情報として扱う
  const severity: DiagnosisSeverity = count > 0 ? "good" : "info"

  return {
    id: "mcp",
    title: "拡張機能（MCP）の稼働",
    severity,
    value: `${formatNumber(count)}回`,
    meaning:
      count > 0
        ? `${serverCount}種類のMCPサーバーが計${formatNumber(count)}回呼ばれており、設定した外部ツールを想定どおり使えています。`
        : "MCPツールが一度も呼ばれていません。MCPを設定していなければ正常な状態です。",
    action:
      count > 0
        ? null
        : "使わせたいMCPがあるのに0回の場合は、プロンプトでの指示不足か、MCPツール側の説明文（description）が曖昧でClaudeが使い所を判断できていない可能性があります。説明文に「いつ使うか」を明記すると改善します。",
    criteria: "1回以上=良好 / 0回=情報（設定していなければ正常）",
    comparison: null,
  }
}

/**
 * お任せ度（ターン/指示）の区分のしきい値。ターン数は、1つの応答が複数の行に分かれて書かれても1回と数える(message.idで重複を除く)。
 * 重複を除く前の数え方では、丸投げ型が50以上・標準が10以上だった。重複を除くと値が約半分(実データの中央値で約1/2.4)になるため、
 * 同じ区分になるよう25・5に改めた(実データ47セッションのうち43件が修正前と同じ区分)。
 */
const AUTONOMY_HIGH = 25
const AUTONOMY_STANDARD = 5

/** 5. AIへの「お任せ度（自律性）」の高さ */
function diagnoseAutonomy(s: SessionSummary, others: SessionSummary[]): SessionDiagnosis {
  const perMessage = turnsPerUserMessage(s)
  // 自律度は高い/低いのどちらが正解ということはなく、使い方の傾向を示す指標のため常に情報扱い
  const style =
    perMessage >= AUTONOMY_HIGH ? "丸投げ型" : perMessage >= AUTONOMY_STANDARD ? "標準" : perMessage > 0 ? "対話型" : "—"

  const meaning =
    perMessage >= AUTONOMY_HIGH
      ? `指示1回あたり平均約${perMessage.toFixed(0)}ターン自走しています。大きめのタスクを任せて長時間自律作業させる高度な使い方ができています。`
      : perMessage >= AUTONOMY_STANDARD
        ? `指示1回あたり平均約${perMessage.toFixed(0)}ターン自走しています。指示と自走のバランスが取れた標準的な使い方です。`
        : `指示1回あたり平均約${perMessage.toFixed(1)}ターンで、細かくやり取りしながら進める対話型の使い方です。`

  const interruptNote =
    s.interruptedToolCallCount > 0
      ? `途中で${s.interruptedToolCallCount}回停止させています。指示が意図どおり伝わっていない可能性があるため、最初の指示に前提や制約を足すと止める必要が減ります。`
      : "途中で停止させた回数は0回で、Claudeの進め方が意図から外れていません。"

  return {
    id: "autonomy",
    title: `お任せ度（${style}）`,
    severity: "info",
    value: `${perMessage.toFixed(1)}ターン/指示`,
    meaning: `${meaning}${interruptNote}`,
    action: null,
    criteria: `${AUTONOMY_HIGH}以上=丸投げ型 / ${AUTONOMY_STANDARD}〜${AUTONOMY_HIGH}=標準 / ${AUTONOMY_STANDARD}未満=対話型（優劣ではなく使い方の傾向）`,
    comparison: buildComparison(perMessage, others.map(turnsPerUserMessage), true),
  }
}

/* ------------------------------------------------------------------ *
 * セッション横断の推移
 * ------------------------------------------------------------------ */

export interface TrendPoint {
  sessionId: string
  /** X軸に出す短いラベル（開始日） */
  label: string
  value: number
  /** 選択中のセッションかどうか（グラフ上で強調する） */
  isCurrent: boolean
}

export interface TrendSeries {
  id: string
  title: string
  /** 値の書式（%・回・文字など） */
  unit: string
  /** 値が大きいほど良いか。優劣が無い指標はnull */
  higherIsBetter: boolean | null
  /** 良好と判定される上限/下限（グラフの基準線）。無ければnull */
  threshold: number | null
  points: TrendPoint[]
}

function shortLabel(startedAt: string | null): string {
  if (!startedAt) return "—"
  const d = new Date(startedAt)
  if (Number.isNaN(d.getTime())) return "—"
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * プロジェクト内の全セッションを古い順（＝最初から）に並べ、指標ごとの推移を組み立てる。
 * 単一セッションの数値だけでは「多い/少ない」が判断できないため、
 * 自分の過去セッションを基準線として示すことを目的とする。
 */
export function buildSessionTrends(
  sessions: SessionSummary[],
  currentSessionId: string | null
): TrendSeries[] {
  const ordered = [...sessions].sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""))

  const build = (
    id: string,
    title: string,
    unit: string,
    higherIsBetter: boolean | null,
    threshold: number | null,
    valueOf: (s: SessionSummary) => number | null
  ): TrendSeries => ({
    id,
    title,
    unit,
    higherIsBetter,
    threshold,
    points: ordered
      .map((s) => {
        const value = valueOf(s)
        return value === null
          ? null
          : {
              sessionId: s.sessionId,
              label: shortLabel(s.startedAt),
              value: Number(value.toFixed(2)),
              isCurrent: s.sessionId === currentSessionId,
            }
      })
      .filter((p): p is TrendPoint => p !== null),
  })

  return [
    build("compaction", "コンパクション回数", "回", false, 1, (s) => s.compactionCount),
    build("errorRate", "ツールエラー率", "%", false, 5, toolErrorRate),
    build("readPrecision", "1回あたり読み取り量", "文字", false, 2000, avgOutputCharsPerCall),
    build("cacheHit", "キャッシュヒット率", "%", true, 90, cacheHitRate),
    build("autonomy", "お任せ度", "ターン/指示", null, null, turnsPerUserMessage),
  ]
}
