import { describe, expect, it } from "vitest"
import {
  avgOutputCharsPerCall,
  buildSessionTrends,
  cacheHitRate,
  diagnoseSession,
  toolErrorRate,
  turnsPerUserMessage,
} from "./sessionDiagnostics"
import { SessionDiagnosisMetrics, SessionSummary } from "./types"

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "s1",
    startedAt: "2026-07-01T00:00:00.000Z",
    endedAt: "2026-07-01T01:00:00.000Z",
    turnCount: 100,
    toolCallCount: 100,
    toolErrorCount: 0,
    totalInputTokens: 1000,
    totalOutputTokens: 1000,
    totalCacheReadTokens: 9900,
    totalCacheCreationTokens: 100,
    compactionCount: 0,
    cwd: null,
    version: null,
    sizeBytes: 0,
    mcpToolCallCount: 0,
    skillCallCount: 0,
    totalToolOutputChars: 50000,
    userMessageCount: 10,
    interruptedToolCallCount: 0,
    hookErrorCount: 0,
    subagentCallCount: 0,
    firstUserMessageExcerpt: null,
    skillNames: [],
    ...overrides,
  }
}

function makeMetrics(overrides: Partial<SessionSummary> = {}): SessionDiagnosisMetrics {
  return {
    summary: makeSummary(overrides),
    mcpCallCountsByServer: {},
  }
}

function find(report: ReturnType<typeof diagnoseSession>, id: string) {
  const d = report.diagnoses.find((x) => x.id === id)
  if (!d) throw new Error(`診断 ${id} が見つかりません`)
  return d
}

describe("指標の計算", () => {
  it("ツールエラー率・キャッシュヒット率・平均読み取り量・お任せ度を算出する", () => {
    const s = makeSummary({
      toolCallCount: 777,
      toolErrorCount: 36,
      totalCacheReadTokens: 99,
      totalCacheCreationTokens: 1,
      totalToolOutputChars: 580000,
      turnCount: 1256,
      userMessageCount: 12,
    })
    expect(toolErrorRate(s)).toBeCloseTo(4.63, 1)
    expect(cacheHitRate(s)).toBeCloseTo(99, 0)
    expect(avgOutputCharsPerCall(s)).toBeCloseTo(746.5, 0)
    expect(turnsPerUserMessage(s)).toBeCloseTo(104.7, 0)
  })

  it("分母が0でもゼロ除算にならない", () => {
    const s = makeSummary({ toolCallCount: 0, toolErrorCount: 0, userMessageCount: 0 })
    expect(toolErrorRate(s)).toBe(0)
    expect(avgOutputCharsPerCall(s)).toBe(0)
    expect(turnsPerUserMessage(s)).toBe(0)
  })

  it("キャッシュの記録が全く無ければnullを返す（0%と区別する）", () => {
    expect(cacheHitRate(makeSummary({ totalCacheReadTokens: 0, totalCacheCreationTokens: 0 }))).toBeNull()
  })
})

describe("セッションの寿命（コンパクション）", () => {
  it("0回なら良好、1回なら注意、2回以上なら要対処", () => {
    expect(find(diagnoseSession(makeMetrics({ compactionCount: 0 })), "lifespan").severity).toBe("good")
    expect(find(diagnoseSession(makeMetrics({ compactionCount: 1 })), "lifespan").severity).toBe("warning")
    expect(find(diagnoseSession(makeMetrics({ compactionCount: 2 })), "lifespan").severity).toBe("critical")
  })

  it("要対処のときは /clear を含む具体的なアクションを返す", () => {
    const d = find(diagnoseSession(makeMetrics({ compactionCount: 3 })), "lifespan")
    expect(d.action).toContain("/clear")
  })

  it("良好なときはアクションを出さない", () => {
    expect(find(diagnoseSession(makeMetrics({ compactionCount: 0 })), "lifespan").action).toBeNull()
  })
})

describe("無限ループ（沼）の兆候", () => {
  it("エラー率5%未満は良好、5〜15%は注意、15%以上は要対処", () => {
    const at = (calls: number, errors: number) =>
      find(diagnoseSession(makeMetrics({ toolCallCount: calls, toolErrorCount: errors })), "error-loop")
        .severity
    expect(at(100, 4)).toBe("good")
    expect(at(100, 5)).toBe("warning")
    expect(at(100, 14)).toBe("warning")
    expect(at(100, 15)).toBe("critical")
  })
})

describe("読み取りの精度", () => {
  it("1回あたり2,000文字未満は良好、5,000文字以上は要対処", () => {
    const at = (chars: number) =>
      find(
        diagnoseSession(makeMetrics({ toolCallCount: 100, totalToolOutputChars: chars })),
        "read-precision"
      ).severity
    expect(at(100 * 1999)).toBe("good")
    expect(at(100 * 2000)).toBe("warning")
    expect(at(100 * 5000)).toBe("critical")
  })

  it("丸読みが疑われるときはgrepでの絞り込みを促す", () => {
    const d = find(
      diagnoseSession(makeMetrics({ toolCallCount: 10, totalToolOutputChars: 100000 })),
      "read-precision"
    )
    expect(d.action).toContain("grep")
  })
})

describe("コストと応答速度（キャッシュ）", () => {
  it("90%以上は良好、70%未満は要対処", () => {
    const at = (read: number, creation: number) =>
      find(
        diagnoseSession(makeMetrics({ totalCacheReadTokens: read, totalCacheCreationTokens: creation })),
        "cache"
      ).severity
    expect(at(90, 10)).toBe("good")
    expect(at(80, 20)).toBe("warning")
    expect(at(60, 40)).toBe("critical")
  })

  it("キャッシュ記録が無い場合は判定不能として情報扱いにする", () => {
    const d = find(
      diagnoseSession(makeMetrics({ totalCacheReadTokens: 0, totalCacheCreationTokens: 0 })),
      "cache"
    )
    expect(d.severity).toBe("info")
    expect(d.value).toBe("—")
  })
})

describe("分業（サブエージェント）", () => {
  it("未使用でも圧縮が起きていなければ情報どまりで、アクションは出さない", () => {
    const d = find(diagnoseSession(makeMetrics({ subagentCallCount: 0, compactionCount: 0 })), "subagent")
    expect(d.severity).toBe("info")
    expect(d.action).toBeNull()
  })

  it("未使用かつ圧縮が起きている場合のみ、切り出しを促す注意にする", () => {
    const d = find(diagnoseSession(makeMetrics({ subagentCallCount: 0, compactionCount: 1 })), "subagent")
    expect(d.severity).toBe("warning")
    expect(d.action).toContain("サブエージェント")
  })

  it("使用していれば良好", () => {
    expect(
      find(diagnoseSession(makeMetrics({ subagentCallCount: 3, compactionCount: 2 })), "subagent").severity
    ).toBe("good")
  })
})

describe("MCPの稼働", () => {
  it("0回は「設定していなければ正常」として情報扱いにする（警告にしない）", () => {
    const d = find(diagnoseSession(makeMetrics({ mcpToolCallCount: 0 })), "mcp")
    expect(d.severity).toBe("info")
    expect(d.action).toContain("description")
  })
})

describe("お任せ度", () => {
  it("優劣のある指標ではないため、値に関わらず常に情報扱いにする", () => {
    expect(find(diagnoseSession(makeMetrics({ turnCount: 1256, userMessageCount: 12 })), "autonomy").severity).toBe("info")
    expect(find(diagnoseSession(makeMetrics({ turnCount: 10, userMessageCount: 10 })), "autonomy").severity).toBe("info")
  })

  it("停止させた回数が0ならその旨を、あれば指示の見直しを促す", () => {
    expect(
      find(diagnoseSession(makeMetrics({ interruptedToolCallCount: 0 })), "autonomy").meaning
    ).toContain("0回")
    expect(
      find(diagnoseSession(makeMetrics({ interruptedToolCallCount: 4 })), "autonomy").meaning
    ).toContain("4回")
  })
})

describe("総合判定", () => {
  it("最も重い判定が全体の判定になる", () => {
    expect(diagnoseSession(makeMetrics({ compactionCount: 2 })).overall).toBe("critical")
    expect(diagnoseSession(makeMetrics({ compactionCount: 1 })).overall).toBe("warning")
    expect(diagnoseSession(makeMetrics()).overall).toBe("good")
  })

  it("情報どまりの軸は総合判定を悪化させない", () => {
    // MCP0回・サブエージェント0回・お任せ度はいずれもinfoのため、全体はgoodのまま
    const report = diagnoseSession(makeMetrics({ mcpToolCallCount: 0, subagentCallCount: 0 }))
    expect(report.overall).toBe("good")
  })

  it("今すぐ効く対処は重い順に最大3件へ絞られる", () => {
    const report = diagnoseSession(
      makeMetrics({
        compactionCount: 2,
        toolCallCount: 100,
        toolErrorCount: 30,
        totalToolOutputChars: 100 * 6000,
        totalCacheReadTokens: 50,
        totalCacheCreationTokens: 50,
        hookErrorCount: 2,
      })
    )
    expect(report.topActions.length).toBe(3)
    expect(report.overall).toBe("critical")
    // 重い順に並ぶため、先頭は必ず要対処（critical）の軸から選ばれる
    const criticalTitles = report.diagnoses
      .filter((d) => d.severity === "critical")
      .map((d) => `【${d.title}】`)
    expect(criticalTitles.some((t) => report.topActions[0].startsWith(t))).toBe(true)
  })

  it("問題が無ければ対処は空になる", () => {
    expect(diagnoseSession(makeMetrics()).topActions).toEqual([])
  })
})

describe("他セッションとの比較", () => {
  it("他セッションが2件未満なら比較を出さない（中央値が偶然に振られるため）", () => {
    const one = [makeSummary({ sessionId: "other1", compactionCount: 5 })]
    expect(find(diagnoseSession(makeMetrics(), one), "lifespan").comparison).toBeNull()
  })

  it("他セッションが2件以上あれば中央値との比較を返す", () => {
    const others = [
      makeSummary({ sessionId: "other1", compactionCount: 4 }),
      makeSummary({ sessionId: "other2", compactionCount: 6 }),
    ]
    const d = find(diagnoseSession(makeMetrics({ compactionCount: 1 }), others), "lifespan")
    expect(d.comparison).toEqual({ current: 1, median: 5, sampleSize: 2, higherIsBetter: false })
  })

  it("自分自身は比較の母集団から除外する", () => {
    const others = [
      makeSummary({ sessionId: "s1", compactionCount: 99 }),
      makeSummary({ sessionId: "other1", compactionCount: 2 }),
      makeSummary({ sessionId: "other2", compactionCount: 4 }),
    ]
    const d = find(diagnoseSession(makeMetrics({ compactionCount: 0 }), others), "lifespan")
    expect(d.comparison?.sampleSize).toBe(2)
    expect(d.comparison?.median).toBe(3)
  })
})

describe("buildSessionTrends", () => {
  it("開始が古い順（最初から）に並べ、選択中セッションへ印を付ける", () => {
    const sessions = [
      makeSummary({ sessionId: "new", startedAt: "2026-07-03T00:00:00.000Z" }),
      makeSummary({ sessionId: "old", startedAt: "2026-07-01T00:00:00.000Z" }),
      makeSummary({ sessionId: "mid", startedAt: "2026-07-02T00:00:00.000Z" }),
    ]
    const trends = buildSessionTrends(sessions, "mid")
    const compaction = trends.find((t) => t.id === "compaction")!
    expect(compaction.points.map((p) => p.sessionId)).toEqual(["old", "mid", "new"])
    expect(compaction.points.filter((p) => p.isCurrent).map((p) => p.sessionId)).toEqual(["mid"])
    expect(compaction.points[0].label).toBe("7/1")
  })

  it("キャッシュ記録の無いセッションはキャッシュ推移から除外する（0%として誤表示しない）", () => {
    const sessions = [
      makeSummary({ sessionId: "a", totalCacheReadTokens: 0, totalCacheCreationTokens: 0 }),
      makeSummary({ sessionId: "b", totalCacheReadTokens: 90, totalCacheCreationTokens: 10 }),
    ]
    const cache = buildSessionTrends(sessions, "b").find((t) => t.id === "cacheHit")!
    expect(cache.points.map((p) => p.sessionId)).toEqual(["b"])
  })

  it("セッションが無くても落ちない", () => {
    expect(buildSessionTrends([], null).every((t) => t.points.length === 0)).toBe(true)
  })
})
