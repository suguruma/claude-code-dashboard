"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import type { DesktopSessionSummary } from "@/lib/desktopSessionTypes"
import { wirePaths, type Rect } from "@/lib/flowLayout"
import { particleRadius, type MemberState } from "@/lib/flowPlayback"
import type { FlowEvent, FlowMember } from "@/lib/flowTypes"
import { OrgCard, type CardFx } from "./OrgCard"

const SVG_NS = "http://www.w3.org/2000/svg"
const EXTERNAL_KEY = "__external"
/** 強調を出しておく時間(ms)。動きを減らす設定のときは、動きの代わりに長めに見せる */
const FLASH_MS = 900
const STATIC_MS = 3_000
/** 線の横のラベル(指示・他グループ連絡の先頭20文字)を出しておく時間(ms)。粒が着いたあとも、この時間は消さない(読むには3秒以上要る) */
const LABEL_MS = 3_500
/** ラベルが消えるまでの薄くなる時間(ms) */
const LABEL_FADE_MS = 400
const COMPACT_MS = 2_400
const DELTA_MS = 2_000

/** 画面に再生する効果。出来事の粒・ラベルと、コンテキストの増えた分の強調 */
export type FxInput = { delayMs: number; event: FlowEvent } | { delayMs: number; delta: { sid: string; text: string } }
export type FxItem = FxInput & { id: number }

export interface OrgNode {
  member: FlowMember
  state: MemberState
  summary: DesktopSessionSummary | null
}

interface OrgChartCanvasProps {
  /** 表示中のグループID(確認用の属性 `data-group-id`) */
  groupId?: string
  /** 指揮役。見つからなければ null(そのときは線も粒も出さず、カードだけを並べる) */
  leader: OrgNode | null
  members: OrgNode[]
  leaderStats: { instructs: number; reports: number; working: number }
  highContextRatio: number
  /** 「最後の出来事から」の基準になる時刻 */
  referenceTime: number
  /** 粒の移動・脈動などを動かすか(動きを減らす設定では false) */
  animate: boolean
  fx: FxItem[]
  onSelect: (id: string) => void
  /** 指揮役がいないときの案内 */
  notice?: ReactNode
}

interface Particle {
  el: SVGCircleElement
  label: HTMLDivElement
  path: SVGPathElement
  container: HTMLElement
  dir: "down" | "up" | "cross"
  start: number
  duration: number
  length: number
  /** 粒が着いたか。着いたあとも、ラベルは labelMs まで残す */
  arrived: boolean
  labelMs: number
  onDone: () => void
}

/** 粒を requestAnimationFrame で動かす。粒もラベルも無いあいだは動かない(待機中にCPUを使わない) */
class ParticleEngine {
  private list: Particle[] = []
  private raf: number | null = null

  add(p: Particle) {
    this.list.push(p)
    if (this.raf === null) this.raf = requestAnimationFrame(this.tick)
  }

  clear() {
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.raf = null
    for (const p of this.list) {
      if (!p.arrived) this.arrive(p, false)
      p.label.remove()
    }
    this.list = []
  }

  /** 粒が着いた。粒を消し、線の強調を外し、着いた先のカードの強調を出す。ラベルは残す */
  private arrive(p: Particle, notify: boolean) {
    p.arrived = true
    p.el.remove()
    if (!this.list.some((q) => q !== p && !q.arrived && q.path === p.path && q.dir === p.dir)) p.path.removeAttribute("data-hot")
    if (notify) p.onDone()
  }

  private tick = (now: number) => {
    const width = this.list[0]?.container.clientWidth ?? 0
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]
      const elapsed = now - p.start
      if (!p.arrived) {
        const k = Math.min(1, elapsed / p.duration)
        const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
        const at = p.path.getPointAtLength((p.dir === "up" ? 1 - eased : eased) * p.length)
        p.el.setAttribute("cx", String(at.x))
        p.el.setAttribute("cy", String(at.y))
        // ラベルは粒に付いて動き、着いたあとは、その位置にとどまる
        const w = p.label.offsetWidth
        p.label.style.left = `${Math.max(4, Math.min(width - w - 4, at.x + 10))}px`
        p.label.style.top = `${Math.max(2, at.y - 24)}px`
        if (k >= 1) this.arrive(p, true)
      }
      const left = p.labelMs - elapsed
      p.label.style.opacity = left < LABEL_FADE_MS ? String(Math.max(0, left / LABEL_FADE_MS)) : "1"
      if (left <= 0) {
        p.label.remove()
        this.list.splice(i, 1)
      }
    }
    this.raf = this.list.length > 0 ? requestAnimationFrame(this.tick) : null
  }
}

const DIR_COLOR = { down: "var(--flow-down)", up: "var(--flow-up)", cross: "var(--flow-cross)" } as const
/** 粒とラベルの `data-kind`(確認用の属性): 下向き=指示、上向き=報告 */
const KIND_OF_DIR = { down: "instruct", up: "report", cross: "cross" } as const

/** 組織図の本体: 指揮役のカードを上に、子のカードを下に並べ、肘型の線と、指示・報告の粒を重ねる */
export function OrgChartCanvas({
  groupId,
  leader,
  members,
  leaderStats,
  highContextRatio,
  referenceTime,
  animate,
  fx,
  onSelect,
  notice,
}: OrgChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const particlesRef = useRef<SVGGElement>(null)
  const externalRef = useRef<HTMLDivElement>(null)
  const cardEls = useRef<Record<string, HTMLDivElement | null>>({})
  const pathEls = useRef<Record<string, SVGPathElement | null>>({})
  const engine = useRef<ParticleEngine | null>(null)
  const timers = useRef(new Set<number>())
  const processed = useRef(0)
  const latest = useRef({ animate, leaderId: leader?.member.id ?? null })
  const [wires, setWires] = useState<{ w: number; h: number; members: Record<string, string>; external: string | null } | null>(null)
  const [cardFx, setCardFx] = useState<Record<string, CardFx>>({})

  useEffect(() => {
    latest.current = { animate, leaderId: leader?.member.id ?? null }
  })

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }, [])

  /** カードの強調を一定時間だけ出す */
  const showFx = useCallback(
    (id: string, patch: CardFx, ms: number) => {
      setCardFx((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
      later(() => {
        setCardFx((prev) => {
          const current = { ...prev[id] }
          for (const key of Object.keys(patch) as Array<keyof CardFx>) delete current[key]
          return { ...prev, [id]: current }
        })
      }, ms)
    },
    [later]
  )

  // ---- 線の配置 -----------------------------------------------------------
  const layout = useCallback(() => {
    const container = containerRef.current
    const leaderId = leader?.member.id
    if (!container || !leaderId) {
      setWires(null)
      return
    }
    const leaderEl = cardEls.current[leaderId]
    if (!leaderEl) return
    const cr = container.getBoundingClientRect()
    const rel = (el: Element): Rect => {
      const r = el.getBoundingClientRect()
      return { left: r.left - cr.left, top: r.top - cr.top, width: r.width, height: r.height }
    }
    const style = gridRef.current ? getComputedStyle(gridRef.current) : null
    const result = wirePaths({
      leader: rel(leaderEl),
      members: members.flatMap((m) => {
        const el = cardEls.current[m.member.id]
        return el ? [{ id: m.member.id, rect: rel(el) }] : []
      }),
      external: externalRef.current ? rel(externalRef.current) : null,
      columnGap: parseFloat(style?.columnGap ?? "") || 14,
      rowGap: parseFloat(style?.rowGap ?? "") || 16,
    })
    const next = { w: cr.width, h: cr.height, ...result }
    setWires((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [leader?.member.id, members])

  useLayoutEffect(() => {
    layout()
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === "undefined") return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(layout)
    })
    observer.observe(container)
    for (const el of Object.values(cardEls.current)) if (el) observer.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [layout, members.length, leader?.member.id])

  // ---- 効果の再生 ---------------------------------------------------------
  const arrive = useCallback(
    (id: string | null, flash: CardFx["flash"]) => {
      if (id && flash) showFx(id, { flash }, latest.current.animate ? FLASH_MS : STATIC_MS)
    },
    [showFx]
  )

  const spawn = useCallback(
    (key: string, dir: Particle["dir"], radius: number, labelText: string, senderOnly: boolean, onDone: () => void) => {
      const container = containerRef.current
      const group = particlesRef.current
      const path = pathEls.current[key]
      if (!container || !group || !path) {
        onDone()
        return
      }
      const color = DIR_COLOR[dir]
      path.setAttribute("data-hot", dir)
      const label = document.createElement("div")
      label.className =
        "pointer-events-none absolute z-[3] whitespace-nowrap rounded-md border bg-card px-1.5 py-0.5 text-[11px] text-foreground shadow-sm"
      label.style.borderColor = color
      if (senderOnly) label.style.borderStyle = "dashed"
      label.dataset.testid = "org-line-label"
      label.dataset.kind = KIND_OF_DIR[dir]
      label.textContent = labelText
      container.appendChild(label)

      const length = path.getTotalLength()
      if (!latest.current.animate) {
        // 動かさない: 線を色と太さで示し、ラベルを線の中ほどに数秒間出す
        const mid = path.getPointAtLength(length / 2)
        label.style.left = `${Math.max(4, mid.x + 10)}px`
        label.style.top = `${Math.max(2, mid.y - 24)}px`
        later(() => label.remove(), LABEL_MS)
        later(() => path.removeAttribute("data-hot"), STATIC_MS)
        onDone()
        return
      }

      const el = document.createElementNS(SVG_NS, "circle")
      el.setAttribute("r", radius.toFixed(1))
      el.setAttribute("class", "org-particle")
      el.dataset.testid = "org-particle"
      el.dataset.kind = KIND_OF_DIR[dir]
      if (senderOnly) {
        el.dataset.receipt = "sender-only"
        el.style.fill = "var(--card)"
        el.style.stroke = color
        el.style.strokeWidth = "2"
        el.style.strokeDasharray = "2 2"
      } else {
        el.style.fill = color
      }
      el.style.color = color
      group.appendChild(el)
      engine.current ??= new ParticleEngine()
      engine.current.add({
        el,
        label,
        path,
        container,
        dir,
        start: performance.now(),
        duration: 650 + Math.min(900, length * 1.6),
        length,
        arrived: false,
        labelMs: LABEL_MS,
        onDone,
      })
    },
    [later]
  )

  const play = useCallback(
    (item: FxItem) => {
      if ("delta" in item) {
        showFx(item.delta.sid, { delta: item.delta.text }, DELTA_MS)
        return
      }
      const e = item.event
      const leaderId = latest.current.leaderId
      switch (e.kind) {
        case "compact":
          showFx(e.sid, { compact: true }, COMPACT_MS)
          break
        case "instruct":
          arrive(e.from, "down")
          spawn(e.to, "down", 6, `${e.summary || "指示"}${e.receipt === "sender-only" ? "（受信未確認）" : ""}`, e.receipt === "sender-only", () =>
            arrive(e.to, "down")
          )
          break
        case "report":
          spawn(e.from, "up", particleRadius(e.tools), e.tools > 0 ? `報告（ツール${e.tools}回）` : "報告", false, () => arrive(leaderId, "up"))
          break
        case "cross":
          spawn(EXTERNAL_KEY, "cross", 5, e.summary || "他から", false, () => arrive(leaderId, "cross"))
          break
        case "end":
          break
      }
    },
    [arrive, showFx, spawn]
  )

  useEffect(() => {
    for (const item of fx) {
      if (item.id <= processed.current) continue
      processed.current = item.id
      later(() => play(item), item.delayMs)
    }
  }, [fx, later, play])

  useEffect(() => {
    const pending = timers.current
    const current = engine.current
    return () => {
      for (const id of pending) window.clearTimeout(id)
      pending.clear()
      current?.clear()
    }
  }, [])

  // 動かす設定が切り替わったら、飛んでいる粒を片づける
  useEffect(() => {
    if (!animate) engine.current?.clear()
  }, [animate])

  const setCardEl = (id: string) => (el: HTMLDivElement | null) => {
    cardEls.current[id] = el
  }

  const cardProps = (node: OrgNode) => ({
    member: node.member,
    state: node.state,
    summary: node.summary,
    highContextRatio,
    referenceTime,
    fx: cardFx[node.member.id],
    onSelect,
    cardRef: setCardEl(node.member.id),
  })

  return (
    <section
      ref={containerRef}
      data-testid="org-chart"
      data-group-id={groupId}
      aria-label="組織図"
      className="relative overflow-hidden rounded-2xl border bg-muted/40 px-3 pb-4 pt-4"
    >
      {leader && (
        <svg
          className="org-wires pointer-events-none absolute inset-0 z-[2] h-full w-full overflow-visible"
          viewBox={wires ? `0 0 ${wires.w} ${wires.h}` : "0 0 1 1"}
          aria-hidden
        >
          <g>
            {members.map((m) =>
              wires?.members[m.member.id] ? (
                <path
                  key={m.member.id}
                  data-kind="down"
                  d={wires.members[m.member.id]}
                  ref={(el) => {
                    pathEls.current[m.member.id] = el
                  }}
                />
              ) : null
            )}
            {wires?.external && (
              <path
                data-kind="cross"
                d={wires.external}
                ref={(el) => {
                  pathEls.current[EXTERNAL_KEY] = el
                }}
              />
            )}
          </g>
          <g ref={particlesRef} />
        </svg>
      )}

      {leader && (
        <div className="@container relative mb-10 flex min-h-[60px] flex-col items-center">
          <OrgCard {...cardProps(leader)} leader={leaderStats} />
          {/* 横に並べる幅があれば指揮役の右に、狭ければカードの上に置く(カードに重ねない) */}
          <div
            ref={externalRef}
            data-testid="org-external"
            className="relative z-[1] order-first mb-3 self-end rounded-full border border-dashed border-[var(--flow-cross)] bg-card px-2 py-0.5 text-[11px] text-foreground @[35rem]:absolute @[35rem]:right-0 @[35rem]:top-1.5 @[35rem]:order-none @[35rem]:mb-0 @[35rem]:self-auto"
            title="他のグループや外部(CLI)からの連絡は、ここから指揮役へ点線で入ります"
          >
            他グループ・外部
          </div>
        </div>
      )}

      {notice}

      <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-3.5 gap-y-4 px-1">
        {members.map((node) => (
          <OrgCard key={node.member.id} {...cardProps(node)} />
        ))}
      </div>
    </section>
  )
}
