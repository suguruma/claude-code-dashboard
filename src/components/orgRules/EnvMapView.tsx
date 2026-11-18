"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import useSWR from "swr"
import { Minus, Plus, Maximize2, RefreshCw, X } from "lucide-react"
import type { Core, ElementDefinition } from "cytoscape"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { fetcher } from "@/lib/fetcher"
import {
  BOX_H,
  ISOLATED_PREFIX,
  MIN_EFFECTIVE_FONT,
  circled,
  fitView,
  labelWidth,
  layoutNow,
  layoutRoute,
  pickInstruction,
  playbackInterval,
  stepInstruction,
  type MapLayout,
} from "@/lib/envMap/envMapLayout"
import { decideSession } from "@/lib/envMap/envMapSelect"
import { GUARD_BOX, type EnvMapData, type EnvMapNode, type EnvMapResponse, type RouteInstruction, type RouteResponse } from "@/lib/envMap/envMapTypes"
import { CONFLICT_EDGE, NORMAL_EDGE, STRENGTH_TEXT, readColors, strengthBorder, type EnvMapColors } from "./envMapTheme"

/**
 * 組織の［全体マップ］(⑲ 段1)。地図(［今］)と、指示ごとのルート(［ルート］。既定)を cytoscape で描く。
 * - cytoscape はこのタブを開いたときだけ読む(A12)。外部と通信しない(同梱)
 * - ホイールはページのスクロール。拡大は Ctrl＋ホイール・［＋］［−］・＋／− キー(A17)
 * - 実効の字が12px 未満のときは箱の名前を出さない(A15)。選ぶと 1.0倍で寄せる
 * - 画面に出すのは、箱の名前・道具の名前・順番・時刻・回数だけ(EM-6)
 */

type Mode = "route" | "now"
const MODE_KEY = "ccd:env-map-mode"
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)"
const MAP_PADDING = 16
const OTHERS_ID = "others:tools"
const ROW_A_MAX = 45

function readMode(): Mode | null {
  try {
    const v = window.localStorage.getItem(MODE_KEY)
    return v === "now" || v === "route" ? v : null
  } catch {
    return null
  }
}

function writeMode(m: Mode): void {
  try {
    window.localStorage.setItem(MODE_KEY, m)
  } catch {
    // 覚えられなくても画面は動く
  }
}

function urlSession(): string | null {
  if (typeof window === "undefined") return null
  const v = new URLSearchParams(window.location.search).get("session")
  return v && /^[A-Za-z0-9_-]{1,120}$/.test(v) ? v : null
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const q = window.matchMedia(REDUCED_QUERY)
      q.addEventListener("change", cb)
      return () => q.removeEventListener("change", cb)
    },
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false
  )
}

const pad2 = (n: number) => String(n).padStart(2, "0")
function dateText(ms: number | null): string {
  if (ms === null) return "―"
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function dayText(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
function agoText(ms: number | null, now: number): string {
  if (ms === null) return ""
  const days = Math.floor((now - ms) / 86400000)
  return days <= 0 ? "今日" : `${days}日前`
}
function durationText(a: number | null, b: number | null): string {
  if (a === null || b === null || b < a) return "―"
  const min = Math.round((b - a) / 60000)
  if (min < 1) return "1分未満"
  if (min < 60) return `${min}分`
  return `${Math.floor(min / 60)}時間${min % 60 ? `${min % 60}分` : ""}`
}

/** 箱の短い名前(画面の文。地図に無い道具は道具の名前のまま) */
function nameOf(key: string, nodes: Map<string, EnvMapNode>): string {
  return nodes.get(key)?.label ?? key
}

/**
 * 既定で選んで指示が無かったセッション(低12)。タブを替える・別のページへ行くと部品は外されるので、部品の外(この窓の中)に覚える(低13)
 */
const skippedSessions: string[] = []

export function EnvMapView() {
  // 一覧はタブを開くたびに取り直す(窓を開いたまま後から始まったセッションを、古い一覧で「出せません」にしない。中7・低17)
  const { data, error, isLoading, isValidating, mutate } = useSWR<EnvMapResponse>("/api/env-map", fetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
  })
  const [fromUrl] = useState(urlSession)
  const [mode, setModeState] = useState<Mode>(() => (fromUrl ? "route" : (readMode() ?? "route")))
  const [session, setSession] = useState<string | null>(fromUrl)
  const [skipped, setSkipped] = useState<string[]>(() => [...skippedSessions])
  /** 一覧に無いセッションを頼まれて、一覧を取り直し終えた id(中7) */
  const [refreshedFor, setRefreshedFor] = useState<string | null>(null)
  const decision = data
    ? decideSession({ requested: session, sessions: data.sessions, defaultSession: data.defaultSession, skipped, validating: isValidating, refreshedFor })
    : null
  const needRefresh = decision?.kind === "checking" && !isValidating && refreshedFor !== session
  /** 取り直しを始めた id(同じ id では1回だけ。取り直しの途中に後片付けが走っても、終わりの印は付ける) */
  const refreshing = useRef<string | null>(null)
  useEffect(() => {
    if (!needRefresh || refreshing.current === session) return
    refreshing.current = session
    void mutate().finally(() => setRefreshedFor(session))
  }, [needRefresh, mutate, session])

  const setMode = useCallback((m: Mode) => {
    setModeState(m)
    writeMode(m)
  }, [])

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>全体マップを読み込めませんでした</AlertTitle>
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    )
  }
  if (isLoading || !data || !decision) return <p className="text-sm text-muted-foreground">地図を読み込んでいます...</p>
  if (!data.map) {
    return (
      <Alert>
        <AlertTitle>地図を描けません</AlertTitle>
        <AlertDescription>{data.problem?.message ?? "地図のデータがありません"}</AlertDescription>
      </Alert>
    )
  }
  if (decision.kind === "checking") return <p className="text-sm text-muted-foreground">セッションの一覧を取り直しています...</p>
  const hasSessions = data.sessions.length > 0
  // URL のセッションが、取り直した一覧(直近30日・会話記録あり・WSL を除く)にも無いときは、別のセッションに差し替えない(中5・中7)
  const missing = decision.kind === "missing"
  const auto = decision.kind === "chosen" && decision.auto
  const autoPick = decision.kind === "chosen" && decision.auto ? decision.id : null
  const chosen = decision.kind === "chosen" ? decision.id : null
  const effectiveMode: Mode = hasSessions ? mode : "now"
  return (
    <EnvMapBody
      res={data}
      map={data.map}
      mode={effectiveMode}
      setMode={setMode}
      session={chosen}
      missing={missing}
      setSession={setSession}
      onEmptyDefault={
        auto && autoPick && skipped.length < 5 && skipped.length < data.sessions.length - 1
          ? () => {
              if (!skippedSessions.includes(autoPick)) skippedSessions.push(autoPick)
              setSkipped((ids) => (ids.includes(autoPick) ? ids : [...ids, autoPick]))
            }
          : undefined
      }
      reload={() => void mutate()}
    />
  )
}

interface BodyProps {
  res: EnvMapResponse
  map: EnvMapData
  mode: Mode
  setMode: (m: Mode) => void
  session: string | null
  /** URL のセッションが一覧に無い(中5) */
  missing: boolean
  setSession: (id: string) => void
  /** 既定で選んだセッションに指示が無かったとき(低12) */
  onEmptyDefault?: () => void
  reload: () => void
}

function EnvMapBody({ res, map, mode, setMode, session, missing, setSession, onEmptyDefault, reload }: BodyProps) {
  const routeKey = mode === "route" && session ? `/api/env-map/route?session=${encodeURIComponent(session)}` : null
  const route = useSWR<RouteResponse>(routeKey, fetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    onSuccess: (d) => {
      if (d.instructions.length === 0 && !d.problem) onEmptyDefault?.()
    },
  })
  const nodes = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map])
  const layerLabel = useMemo(() => new Map(map.layers.map((l) => [l.id, l.label])), [map])
  const [pick, setPick] = useState<{ session: string | null; index: number | null }>({ session: null, index: null })
  const instructions = useMemo(() => route.data?.instructions ?? [], [route.data])
  const indexes = useMemo(() => instructions.map((i) => i.index), [instructions])
  const index = pickInstruction(indexes, pick.session === session ? pick.index : null)
  const ins = instructions.find((i) => i.index === index) ?? null
  const prevIndex = stepInstruction(indexes, index, -1)
  const nextIndex = stepInstruction(indexes, index, 1)
  const [selected, setSelected] = useState<string | null>(null)
  const [layerFilter, setLayerFilter] = useState<string>("all")
  const [play, setPlay] = useState<number | null>(null)
  const [staleNote, setStaleNote] = useState(false)
  const reduced = useReducedMotion()
  const sessionItem = res.sessions.find((s) => s.id === session) ?? null

  const choose = (i: number) => {
    setPick({ session, index: i })
    setPlay(null)
  }
  /** 一覧で開く層。scroll は「つながり無し n」を押したときだけ(探して選んだときは、行A が見えるようにページを動かさない。A16) */
  const [openLayerReq, setOpenLayerReq] = useState<{ id: string; scroll: boolean; n: number } | null>(null)
  const openLayer = useCallback((layer: string, scroll = true) => setOpenLayerReq((r) => ({ id: layer, scroll, n: (r?.n ?? 0) + 1 })), [])
  const choosePrev = () => prevIndex !== null && choose(prevIndex)
  const chooseNext = () => nextIndex !== null && choose(nextIndex)

  // 再生(初めて通った順。全体15秒以内・1歩300ms 以上。動きを減らす設定では再生しない。A20)
  const visits = useMemo(() => ins?.visits ?? [], [ins])
  useEffect(() => {
    if (play === null) return
    if (play >= visits.length) {
      const t = setTimeout(() => setPlay(null), playbackInterval(visits.length))
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setPlay(play + 1), playbackInterval(visits.length))
    return () => clearTimeout(t)
  }, [play, visits.length])
  useEffect(() => {
    if (play === null) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return
      if (e.key === "Escape") setPlay(null)
      else if (e.key === "ArrowRight") setPlay((p) => (p === null ? p : Math.min(visits.length, p + 1)))
      else if (e.key === "ArrowLeft") setPlay((p) => (p === null ? p : Math.max(1, p - 1)))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [play, visits.length])

  // 行A(結論と選んだ物の1行。読み上げの領域)
  const sel = selected ? nodes.get(selected) : null
  let rowA: React.ReactNode
  if (sel) {
    rowA = (
      <>
        <span className="font-medium">{sel.label}</span>
        <span>
          ・{layerLabel.get(sel.layer) ?? sel.layer}
          {STRENGTH_TEXT[sel.strength] ? `・${STRENGTH_TEXT[sel.strength]}` : ""}・つながり {sel.degree}
          {mode === "now" && sel.degree === 0 && layerFilter !== "linked"
            ? `（つながり無し ${map.nodes.filter((n) => n.layer === sel.layer && n.degree === 0).length} の中）`
            : ""}
          {mode === "route" && ins && !ins.visits.some((v) => v.box === sel.id) ? "（この指示では通っていません）" : ""}
        </span>
        <button type="button" className="ml-2 rounded px-1 text-muted-foreground hover:bg-muted" onClick={() => setSelected(null)} aria-label="選んだ箱を外す">
          <X className="inline size-4" />
        </button>
      </>
    )
  } else if (mode === "route" && ins) {
    const boxes = ins.visits.length
    rowA = (
      <span>
        {map.stale && (
          <button type="button" className="mr-1 underline decoration-dotted" onClick={() => setStaleNote((v) => !v)} aria-expanded={staleNote}>
            地図が古い（{agoText(map.generatedAt, res.generatedAt)}）▸
          </button>
        )}
        箱 {play !== null ? `${Math.min(play, boxes)}/${boxes}` : boxes}（通った順）・歩 {ins.steps.length}・道具 {ins.calls}回
        {ins.agents > 0 ? `・役 ${ins.agents}` : ""}
        {ins.running ? "・途中" : ""}
        {staleNote && <span className="ml-2 text-muted-foreground">地図は、地図を作る仕組みが作り直します</span>}
      </span>
    )
  } else {
    const made = map.stale
      ? null
      : map.generatedAt === null
        ? "地図の作成日は不明"
        : `地図の作成 ${dateText(map.generatedAt)}（${agoText(map.generatedAt, res.generatedAt)}）`
    const head = `箱 ${map.nodes.length}・線 ${map.edges.length}・`
    const hint = "人から見るのは［つながり］、仕組みから見るのはここ"
    const withHint = made && (head + made + "。" + hint).length <= ROW_A_MAX
    rowA = (
      <span>
        {head}
        {made ?? (
          <button type="button" className="underline decoration-dotted" onClick={() => setStaleNote((v) => !v)} aria-expanded={staleNote}>
            地図が古い可能性があります（{map.generatedAt !== null ? `${dayText(map.generatedAt)}・${agoText(map.generatedAt, res.generatedAt)}` : "作成日不明"}）▸
          </button>
        )}
        {withHint ? `。${hint}` : ""}
        {staleNote && <span className="ml-2 text-muted-foreground">地図は、地図を作る仕組みが作り直します</span>}
      </span>
    )
  }

  return (
    <div className="space-y-0">
      <div className="flex h-10 items-center gap-1 overflow-hidden text-sm" aria-live="polite" data-row="A">
        {rowA}
      </div>
      <MapControls
        mode={mode}
        setMode={(m) => {
          setMode(m)
          setSelected(null)
          setPlay(null)
        }}
        canRoute={res.sessions.length > 0}
        map={map}
        layerFilter={layerFilter}
        setLayerFilter={setLayerFilter}
        onSearch={(id) => setSelected(id)}
      />
      {mode === "route" && (
        <div className="flex min-h-12 flex-wrap items-center gap-2 py-2 text-sm" data-row="C">
          <label className="sr-only" htmlFor="env-map-session">
            セッション
          </label>
          <select
            id="env-map-session"
            className="h-8 w-[200px] truncate rounded-md border bg-background px-2"
            value={session ?? ""}
            onChange={(e) => {
              if (!e.target.value) return
              setSession(e.target.value)
              setSelected(null)
              setPlay(null)
            }}
          >
            {!session && <option value="">セッションを選ぶ</option>}
            {res.sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="env-map-instruction">
            指示
          </label>
          <select
            id="env-map-instruction"
            className="h-8 w-[240px] truncate rounded-md border bg-background px-2"
            value={index ?? ""}
            disabled={!instructions.length}
            title={ins ? instructionText(ins, nodes) : undefined}
            onChange={(e) => {
              choose(Number(e.target.value))
              setPlay(null)
            }}
          >
            {[...instructions].reverse().map((i) => (
              <option key={i.index} value={i.index}>
                {instructionText(i, nodes)}
              </option>
            ))}
          </select>
          <Button variant="outline" size="icon-sm" onClick={choosePrev} disabled={prevIndex === null} aria-label="前の指示" title="前の指示">
            ◀
          </Button>
          <Button variant="outline" size="icon-sm" onClick={chooseNext} disabled={nextIndex === null} aria-label="次の指示" title="次の指示">
            ▶
          </Button>
          {play === null ? (
            <Button variant="outline" size="sm" className="w-[120px] text-sm" disabled={!ins || ins.visits.length === 0 || reduced} onClick={() => {
                setSelected(null)
                setPlay(1)
              }} title={reduced ? "動きを減らす設定のため、番号だけを出しています" : undefined}>
              順に光らせる
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="w-[120px] text-sm" onClick={() => setPlay(null)}>
              止める（Esc）
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => void route.mutate()} aria-label="読み直す" title="会話記録を読み直す（自動では読み直しません）">
            <RefreshCw className="size-4" />
          </Button>
        </div>
      )}
      {mode === "route" && missing && !session && (
        <Alert>
          <AlertDescription>
            このセッションは地図に出せません（WSL のセッション・直近30日に動いていない・会話記録が無い、のどれかです）。上の欄から別のセッションを選べます。
          </AlertDescription>
        </Alert>
      )}
      {mode === "route" && route.isLoading && (
        <p className="py-2 text-sm text-muted-foreground">読んでいます{sessionItem ? `（${Math.max(0.1, Math.round(sessionItem.bytes / 1e5) / 10)} MB）` : ""}...</p>
      )}
      {mode === "route" && route.error && (
        <Alert variant="destructive">
          <AlertDescription>{(route.error as Error).message}</AlertDescription>
        </Alert>
      )}
      {mode === "route" && route.data?.problem && (
        <Alert variant="destructive">
          <AlertDescription>{route.data.problem}</AlertDescription>
        </Alert>
      )}
      {mode === "route" && route.data && !route.data.problem && !ins && <p className="py-2 text-sm">このセッションには、まだ指示がありません。</p>}
      <MapCanvas
        note={mode === "route" && ins ? <EmptyNote ins={ins} group={route.data?.group ?? null} nodes={nodes} /> : null}
        measureKey={`${route.isLoading}|${Boolean(route.error)}|${route.data?.problem ?? ""}|${Boolean(route.data && !ins)}`}
        onIsolated={openLayer}
        map={map}
        mode={mode}
        ins={mode === "route" ? ins : null}
        selected={selected}
        setSelected={setSelected}
        layerFilter={layerFilter}
        play={play}
        reduced={reduced}
      />
      <Legend map={map} now={res.generatedAt} />
      <DetailPanel
        map={map}
        nodes={nodes}
        layerLabel={layerLabel}
        selected={selected}
        setSelected={setSelected}
        ins={mode === "route" ? ins : null}
        reload={reload}
        openLayer={openLayerReq}
      />
    </div>
  )
}

function instructionText(i: RouteInstruction, nodes: Map<string, EnvMapNode>): string {
  const top = i.top.map((t) => `${shortName(nameOf(t.key, nodes))} ${t.count}`).join("・")
  // 通ったスキル・役と出口の箱(2つまで。4-2 の⑤)
  const marks = i.visits
    .filter((v) => /^(skill|agent|out):/.test(v.box))
    .slice(0, 2)
    .map((v) => shortName(nameOf(v.box, nodes)))
    .join("・")
  const head = i.index === 0 ? "最初の指示の前" : `#${i.index}`
  return `${head} ${dateText(i.startAt)}・${durationText(i.startAt, i.endAt)}${top ? `・${top}` : ""}${marks ? ` › ${marks}` : ""}${i.running ? "・途中" : ""}`
}

/** 指示の一覧で使う短い名前(括弧の中の補足を落とす) */
function shortName(label: string): string {
  return label.replace(/[（(].*$/, "").trim() || label
}

function EmptyNote({ ins, group, nodes }: { ins: RouteInstruction; group: string | null; nodes: Map<string, EnvMapNode> }) {
  const notes: string[] = []
  if (ins.empty === "no-tools") notes.push("この指示では道具を使っていません")
  if (ins.empty === "no-box") {
    const o = ins.others.slice(0, 3).map((x) => `${x.key} ${x.count}`).join("・")
    notes.push(`この指示は、地図の箱を通っていません（道具 ${ins.calls}回${o ? `：${o}` : ""}）`)
  }
  if (!group) notes.push("グループ不明（作業フォルダが地図の台帳に無い）")
  if (notes.length === 0) return null
  void nodes
  return (
    <ul className="rounded border bg-background/90 px-2 py-1 text-sm text-muted-foreground" data-empty="route">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  )
}

interface ControlsProps {
  mode: Mode
  setMode: (m: Mode) => void
  canRoute: boolean
  map: EnvMapData
  layerFilter: string
  setLayerFilter: (v: string) => void
  onSearch: (id: string) => void
}

function MapControls({ mode, setMode, canRoute, map, layerFilter, setLayerFilter, onSearch }: ControlsProps) {
  const [q, setQ] = useState("")
  const [cursor, setCursor] = useState(0)
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return map.nodes.filter((n) => n.label.toLowerCase().includes(s)).slice(0, 8)
  }, [q, map])
  const zoomBy = (f: number) => window.dispatchEvent(new CustomEvent("ccd:env-map-zoom", { detail: f }))
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-2 py-2 text-sm" data-row="B">
      <div className="inline-flex rounded-md border" role="group" aria-label="見せ方">
        <button
          type="button"
          className={`h-8 px-3 ${mode === "now" ? "bg-muted font-medium" : ""}`}
          aria-pressed={mode === "now"}
          onClick={() => setMode("now")}
        >
          今
        </button>
        <button
          type="button"
          className={`h-8 border-l px-3 ${mode === "route" ? "bg-muted font-medium" : ""}`}
          aria-pressed={mode === "route"}
          disabled={!canRoute}
          onClick={() => setMode("route")}
          title={canRoute ? undefined : "直近30日に動いたセッションがありません"}
        >
          ルート
        </button>
      </div>
      <div className="relative">
        <label className="sr-only" htmlFor="env-map-search">
          箱を探す
        </label>
        <input
          id="env-map-search"
          className="h-8 w-[200px] rounded-md border bg-background px-2"
          placeholder="箱を探す"
          value={q}
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="env-map-search-list"
          onChange={(e) => {
            setQ(e.target.value)
            setCursor(0)
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setCursor((c) => Math.min(hits.length - 1, c + 1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setCursor((c) => Math.max(0, c - 1))
            } else if (e.key === "Enter" && hits[cursor]) {
              onSearch(hits[cursor].id)
              setQ("")
            } else if (e.key === "Escape") setQ("")
          }}
        />
        {hits.length > 0 && (
          <ul id="env-map-search-list" role="listbox" className="absolute z-20 mt-1 w-[260px] rounded-md border bg-popover p-1 shadow">
            {hits.map((n, i) => (
              <li key={n.id} role="option" aria-selected={i === cursor}>
                <button
                  type="button"
                  className={`w-full truncate rounded px-2 py-1 text-left ${i === cursor ? "bg-muted" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSearch(n.id)
                    setQ("")
                  }}
                >
                  {n.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <label className="sr-only" htmlFor="env-map-layer">
        層
      </label>
      <select id="env-map-layer" className="h-8 rounded-md border bg-background px-2" value={layerFilter} onChange={(e) => setLayerFilter(e.target.value)}>
        <option value="all">層：すべて</option>
        <option value="linked">つながりのある箱だけ</option>
        {map.layers.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      <div className="ml-auto inline-flex gap-1">
        <Button variant="outline" size="icon-sm" onClick={() => zoomBy(1.25)} aria-label="拡大" title="拡大（＋ キー・Ctrl＋ホイール）">
          <Plus className="size-4" />
        </Button>
        <Button variant="outline" size="icon-sm" onClick={() => zoomBy(0.8)} aria-label="縮小" title="縮小（− キー・Ctrl＋ホイール）">
          <Minus className="size-4" />
        </Button>
        <Button variant="outline" size="sm" className="text-sm" onClick={() => zoomBy(0)} title="全体を表示">
          <Maximize2 className="size-4" />
          全体を表示
        </Button>
      </div>
    </div>
  )
}

interface CanvasProps {
  /** 地図の右上に重ねる文(空の状態など。縦の予算を使わない) */
  note: React.ReactNode
  /** 地図の上の行が出入りしたときに測り直すための印 */
  measureKey: string
  /** 「つながり無し n」を押したとき(層の id)。scroll=false は一覧を開くだけ */
  onIsolated: (layer: string, scroll?: boolean) => void
  map: EnvMapData
  mode: Mode
  ins: RouteInstruction | null
  selected: string | null
  setSelected: (id: string | null) => void
  layerFilter: string
  play: number | null
  reduced: boolean
}

/** ルートの詰めた表示に出す箱(通った箱＋見張りの印＋「ほか」)と、その名前 */
function routeView(map: EnvMapData, ins: RouteInstruction) {
  const extra: EnvMapNode[] = []
  const visits = [...ins.visits]
  const labels = new Map<string, string>()
  const byId = new Map(map.nodes.map((n) => [n.id, n]))
  for (const v of ins.visits) {
    const n = byId.get(v.box)
    if (!n) continue
    const back = v.visits > 1 ? ` ↺${v.visits - 1}` : ""
    // 詰めた表示は括弧の補足を落とした短い名前(全体の名前は選ぶと行A と欄に出る)
    labels.set(v.box, `${circled(v.order)} ${shortName(n.label)}${v.calls > 0 ? ` ${v.calls}回` : ""}${back}`)
  }
  const guard = byId.get(GUARD_BOX)
  if (guard && ins.guard > 0 && !labels.has(GUARD_BOX)) {
    visits.push({ box: GUARD_BOX, order: 0, calls: ins.guard, visits: 0 })
    labels.set(GUARD_BOX, `🛡 ${shortName(guard.label)} ×${ins.guard}`)
  }
  if (ins.others.length > 0) {
    const text = `ほか：${ins.others.slice(0, 3).map((o) => `${o.key} ${o.count}`).join("・")}${ins.others.length > 3 ? ` ほか${ins.others.length - 3}種` : ""}`
    const toolLayer = byId.get("tool:cc-shell")?.layer ?? map.layers.find((l) => l.id === "tools")?.id ?? map.layers[map.layers.length - 1]?.id ?? "tools"
    extra.push({ id: OTHERS_ID, layer: toolLayer, label: text, kind: "", strength: "none", place: "", desc: "", degree: 0 })
    visits.push({ box: OTHERS_ID, order: 0, calls: 0, visits: 0 })
    labels.set(OTHERS_ID, text)
  }
  const data: EnvMapData = { ...map, nodes: [...map.nodes.map((n) => (labels.has(n.id) ? { ...n, label: labels.get(n.id)! } : n)), ...extra] }
  const marks = new Set<string>([OTHERS_ID, ...(ins.visits.some((v) => v.box === GUARD_BOX) ? [] : [GUARD_BOX])])
  return { data, visits, labels, marks }
}

function MapCanvas({ note, measureKey, onIsolated, map, mode, ins, selected, setSelected, layerFilter, play, reduced }: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const layoutRef = useRef<MapLayout | null>(null)
  const [height, setHeight] = useState(420)
  const [width, setWidth] = useState(720)
  const [bands, setBands] = useState<{ label: string; top: number; h: number; count: number }[]>([])
  /** cytoscape を作り直した回数。選択と再生の印は、作り直すたびに当て直す(相談役 重1) */
  const [cyVer, setCyVer] = useState(0)
  const [hover, setHover] = useState<{ label: string; x: number; y: number } | null>(null)
  /** まとめた中の箱で一覧を開いた最後の箱(同じ箱では開き直さない) */
  const openedFor = useRef<string | null>(null)

  // 地図の高さ:画面の下端−16px まで(縦の予算。A11)。ルートの詰めた表示が 1.0倍で入らなければ伸ばす(ページで送る。低A)。
  // 上の行(空の状態の文など)が出入りすると地図の上端が動くので、指示が替わるたびに測り直す
  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current
      if (!el) return
      setHeight(Math.max(280, mapBudgetHeight(el)))
      setWidth(el.clientWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrapRef.current) ro.observe(wrapRef.current)
    window.addEventListener("resize", measure)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [mode, ins, measureKey])

  // 色はテーマから。テーマを替えたら読み直す(A19。next-themes は html の class を替える)
  const themeKey = useSyncExternalStore(subscribeTheme, themeSnapshot, () => null)
  const colors = useMemo<EnvMapColors | null>(() => (themeKey === null ? null : readColors()), [themeKey])

  const view = useMemo(() => {
    const avail = Math.max(320, width - MAP_PADDING * 2)
    if (mode === "route" && ins) {
      const r = routeView(map, ins)
      return { kind: "route" as const, layout: layoutRoute(r.data, r.visits, avail, r.marks), data: r.data, ins }
    }
    let data = map
    if (layerFilter === "linked") data = { ...map, nodes: map.nodes.filter((n) => n.degree > 0) }
    else if (layerFilter !== "all") data = { ...map, layers: map.layers.filter((l) => l.id === layerFilter), nodes: map.nodes.filter((n) => n.layer === layerFilter) }
    return { kind: "now" as const, layout: layoutNow(data, avail), data, ins: null }
  }, [map, mode, ins, layerFilter, width])

  // 1.0倍で見せるか:ルートはいつも。［今］は幅が 1.0倍で入り、高さが 0.85倍以上で入るとき(字を隠すより、地図を伸ばしてページで送る。低A)
  const atOne = useMemo(() => {
    if (view.kind === "route") return true
    const byWidth = fitView(view.layout, width, Number.MAX_SAFE_INTEGER, MAP_PADDING).zoom
    const both = fitView(view.layout, width, height, MAP_PADDING).zoom
    // 幅は 0.97 まで許す(縦のスクロールバーの出入りで幅が少し減っても、判定が行き来しない)
    return byWidth >= 0.97 && both >= 0.85
  }, [view, width, height])
  const mapHeight = atOne ? Math.max(height, view.layout.height + MAP_PADDING * 2) : height

  // cytoscape を作る(このタブを開いたときだけ読み込む。A12)
  useEffect(() => {
    let alive = true
    const container = boxRef.current
    if (!container || !colors) return
    void import("cytoscape").then((mod) => {
      if (!alive || !boxRef.current) return
      const cytoscape = mod.default
      cyRef.current?.destroy()
      const layout = view.layout
      layoutRef.current = layout
      const byId = new Map(view.data.nodes.map((n) => [n.id, n]))
      const els: ElementDefinition[] = []
      for (const b of layout.boxes) {
        const n = byId.get(b.id)
        const isolated = b.id.startsWith(ISOLATED_PREFIX)
        const label = isolated ? (layout.isolated.has(b.id) ? `つながり無し ${layout.isolated.get(b.id)!.length}` : b.id) : (n?.label ?? b.id)
        const border = strengthBorder(n?.strength ?? "none")
        els.push({
          group: "nodes",
          data: { id: b.id, label, w: labelWidth(label), bw: border.width, bs: border.style },
          position: { x: b.x, y: b.y },
          classes: [isolated ? "isolated" : "", border.muted && !isolated ? "weak" : "", b.id === OTHERS_ID ? "others" : "", b.id === GUARD_BOX && view.kind === "route" ? "guard" : "", view.kind === "route" && b.id !== OTHERS_ID && b.id !== GUARD_BOX ? "lit" : ""]
            .filter(Boolean)
            .join(" "),
        })
      }
      const present = new Set(layout.boxes.map((b) => b.id))
      if (view.kind === "now") {
        map.edges.forEach((e, i) => {
          if (present.has(e.src) && present.has(e.dst)) els.push({ group: "edges", data: { id: `e${i}`, source: e.src, target: e.dst }, classes: e.conflict ? "conflict" : "" })
        })
      } else if (view.ins) {
        // ルートの線:時刻の順の歩で、箱が変わる所(同じ組は1本)
        const seen = new Set<string>()
        const steps = view.ins.steps
        for (let i = 1; i < steps.length; i++) {
          const a = steps[i - 1].box
          const b = steps[i].box
          const k = `${a}>${b}`
          if (a === b || seen.has(k) || !present.has(a) || !present.has(b)) continue
          seen.add(k)
          els.push({ group: "edges", data: { id: `r${seen.size}`, source: a, target: b }, classes: "route" })
        }
      }
      const cy = cytoscape({
        container: boxRef.current,
        elements: els,
        layout: { name: "preset" },
        userZoomingEnabled: false,
        boxSelectionEnabled: false,
        autoungrabify: true,
        autounselectify: true,
        style: styleOf(colors),
      })
      cyRef.current = cy
      // 枠の大きさは DOM から読む(作った直後の cy.width() は 0 のことがある)
      const vw = boxRef.current.clientWidth || width
      const vh = boxRef.current.clientHeight || mapHeight
      const fit = fitView(layout, vw, vh, MAP_PADDING)
      cy.minZoom(Math.min(fit.zoom * 0.8, 1))
      cy.maxZoom(2.5)
      // ルートの詰めた表示は 1.0倍(枠に入らなければ地図の高さを伸ばしてページで送る)。［今］は全体を表示
      const start = atOne ? fitView(layout, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, MAP_PADDING) : fit
      cy.zoom(start.zoom)
      cy.pan(start.pan)
      // 実効12px 未満の字は出さない(A15)
      const syncLabels = () => cy.nodes().toggleClass("nolabel", cy.zoom() * 12 < MIN_EFFECTIVE_FONT - 0.01)
      cy.on("zoom", syncLabels)
      syncLabels()
      cy.on("mouseover", "node", (e) => {
        const t = e.target as unknown as { data(k: string): unknown; renderedPosition(): { x: number; y: number } }
        if (cy.zoom() * 12 >= MIN_EFFECTIVE_FONT) return
        const p = t.renderedPosition()
        setHover({ label: String(t.data("label") ?? ""), x: p.x, y: p.y })
      })
      cy.on("mouseout", "node", () => setHover(null))
      cy.on("viewport", () => setHover(null))
      const syncBands = () => {
        const z = cy.zoom()
        const p = cy.pan()
        setBands(layout.bands.map((b) => ({ label: view.data.layers.find((l) => l.id === b.layer)?.label ?? b.layer, top: b.y * z + p.y, h: b.h * z, count: b.count })))
      }
      cy.on("viewport", syncBands)
      syncBands()
      cy.on("tap", "node", (e) => {
        const id = (e.target as { id(): string }).id()
        if (id === OTHERS_ID) return
        if (id.startsWith(ISOLATED_PREFIX)) {
          onIsolated(id.slice(ISOLATED_PREFIX.length))
          return
        }
        setSelected(id)
      })
      cy.on("tap", (e) => {
        if (e.target === cy) setSelected(null)
      })
      setCyVer((v) => v + 1)
    })
    return () => {
      alive = false
    }
  }, [view, colors, map.edges, setSelected, onIsolated, width, mapHeight, atOne])

  useEffect(
    () => () => {
      cyRef.current?.destroy()
      cyRef.current = null
    },
    []
  )

  // 選んだ箱:近傍以外の線を消し、近傍以外の箱を薄く(0.12)、1.0倍で真ん中に寄せる(A2・A21)
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || cyVer === 0 || cy.destroyed()) return
    // まとめた中の箱(つながり無し n)を選んだときは、その「つながり無し n」の箱に印を付けて寄せ、一覧のその層を開く(中1)
    let targetId = selected
    if (selected && cy.getElementById(selected).length === 0) {
      for (const [groupId, members] of layoutRef.current?.isolated ?? []) {
        if (members.includes(selected)) {
          targetId = groupId
          if (openedFor.current !== selected) {
            openedFor.current = selected
            onIsolated(groupId.slice(ISOLATED_PREFIX.length), false)
          }
          break
        }
      }
    }
    cy.batch(() => {
      cy.elements().removeClass("faded").removeClass("hidden").removeClass("picked")
      if (!targetId) return
      const target = cy.getElementById(targetId)
      if (!target || target.length === 0) return
      const keep = target.closedNeighborhood()
      cy.nodes().difference(keep.nodes()).addClass("faded")
      cy.edges().difference(target.connectedEdges()).addClass("hidden")
      target.addClass("picked")
    })
    const target = cy.getElementById(targetId ?? "")
    if (targetId && target && target.length > 0 && atOne && cy.zoom() >= 1) {
      scrollToMapY(boxRef.current, target.position().y * cy.zoom() + cy.pan().y)
      return
    }
    if (targetId && target && target.length > 0) {
      const p = target.position()
      const z = Math.max(1, cy.zoom())
      const pan = { x: cy.width() / 2 - p.x * z, y: cy.height() / 2 - p.y * z }
      if (reduced) {
        cy.zoom(z)
        cy.pan(pan)
      } else cy.animate({ zoom: z, pan, duration: 250 })
    }
  }, [selected, cyVer, reduced, view, atOne, onIsolated])

  // 再生の光(初めて通った順)
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || cyVer === 0 || cy.destroyed() || view.kind !== "route" || !view.ins) return
    cy.batch(() => {
      cy.nodes().removeClass("current").removeClass("dim")
      if (play === null) return
      const order = view.ins!.visits
      order.forEach((v, i) => {
        const el = cy.getElementById(v.box)
        if (!el || el.length === 0) return
        if (i + 1 === play) el.addClass("current")
        else if (i + 1 > play) el.addClass("dim")
      })
    })
  }, [play, cyVer, view])

  // 拡大:Ctrl＋ホイール(passive:false で画面全体の拡大より先に受ける。軽13)・＋／− キー・ボタン
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const zoomAt = (factor: number, at?: { x: number; y: number }) => {
      const cy = cyRef.current
      if (!cy || cy.destroyed()) return
      if (factor === 0) {
        const layout = layoutRef.current
        const box = boxRef.current
        if (!layout || !box) return
        const fit = fitView(layout, box.clientWidth, box.clientHeight, MAP_PADDING)
        cy.zoom(fit.zoom)
        cy.pan(fit.pan)
        return
      }
      const level = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor))
      cy.zoom({ level, renderedPosition: at ?? { x: cy.width() / 2, y: cy.height() / 2 } })
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, { x: e.clientX - r.left, y: e.clientY - r.top })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") zoomAt(1.25)
      else if (e.key === "-") zoomAt(0.8)
    }
    const onButton = (e: Event) => zoomAt((e as CustomEvent<number>).detail)
    el.addEventListener("wheel", onWheel, { passive: false })
    el.addEventListener("keydown", onKey)
    window.addEventListener("ccd:env-map-zoom", onButton)
    return () => {
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("keydown", onKey)
      window.removeEventListener("ccd:env-map-zoom", onButton)
    }
  }, [])

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden rounded-md border" style={{ height: mapHeight }}>
      <div
        ref={boxRef}
        // cytoscape は器の position を relative に替えるので、inset ではなく幅と高さで大きさを決める
        style={{ width: "100%", height: "100%" }}
        tabIndex={0}
        role="img"
        aria-label={`${mode === "route" ? "指示のルート" : "AI 環境の全体マップ"}。一覧で同じ中身を読めます`}
        data-env-map="canvas"
      />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-28" aria-hidden="true">
        {bands.map((b) =>
          b.top + b.h < 0 || b.top > mapHeight ? null : (
            <div key={b.label} className="absolute left-1 whitespace-nowrap rounded bg-background/85 px-1 text-sm leading-5 text-muted-foreground" style={{ top: Math.max(0, b.top + Math.max(0, (b.h - 20) / 2)) }}>
              {b.label} {b.count}
            </div>
          )
        )}
      </div>
      {note && <div className="absolute right-2 top-2 z-10 max-w-[60%]">{note}</div>}
      {hover && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 rounded border bg-popover px-2 py-0.5 text-sm shadow" style={{ left: hover.x, top: hover.y + 22 }}>
          {hover.label}
        </div>
      )}
      <p className="pointer-events-none absolute bottom-1 right-2 rounded bg-background/85 px-1 text-sm text-muted-foreground">ホイールでページを送る・Ctrl＋ホイールで拡大</p>
    </div>
  )
}

/** いちばん近い縦にスクロールする親(この画面では <main>)。無ければ null(ページ全体) */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let p: HTMLElement | null = el.parentElement
  while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement
  return p
}

/**
 * 地図の高さの予算:スクロールの位置に関係なく、送っていないときの「地図の上端から、見える所の下端−16px」(中4)。
 * <main> が送られていても、送った分を足し戻して測る
 */
export function mapBudgetHeight(el: HTMLElement): number {
  const parent = scrollParentOf(el)
  const r = el.getBoundingClientRect()
  if (!parent) return window.innerHeight - (r.top + window.scrollY) - 16
  const pr = parent.getBoundingClientRect()
  const topInParent = r.top - pr.top + parent.scrollTop
  return parent.clientHeight - topInParent - 16
}

/** 地図の中の y(画面の px)が見える所まで、ページ(いちばん近い縦にスクロールする親)を送る */
function scrollToMapY(box: HTMLElement | null, y: number): void {
  if (!box) return
  let el: HTMLElement | null = box.parentElement
  while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement
  const scroller: HTMLElement = el ?? document.scrollingElement as HTMLElement
  const r = box.getBoundingClientRect()
  const view = el ? el.getBoundingClientRect() : { top: 0, bottom: window.innerHeight }
  const abs = r.top + y
  if (abs < view.top + 40 || abs > view.bottom - 40) scroller.scrollBy({ top: abs - (view.top + view.bottom) / 2 })
}

function subscribeTheme(cb: () => void): () => void {
  const mo = new MutationObserver(cb)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] })
  return () => mo.disconnect()
}

function themeSnapshot(): string {
  const el = document.documentElement
  return `${el.className}|${el.getAttribute("style") ?? ""}|${el.getAttribute("data-theme") ?? ""}`
}

/** cytoscape の見た目(色はテーマから。字は12px。実効12px 未満は隠す) */
function styleOf(c: EnvMapColors): unknown {
  return [
    {
      selector: "node",
      style: {
        shape: "round-rectangle",
        width: "data(w)",
        height: BOX_H,
        label: "data(label)",
        "font-size": 12,
        "min-zoomed-font-size": MIN_EFFECTIVE_FONT,
        "text-valign": "center",
        "text-halign": "center",
        color: c.fg,
        "background-color": c.box,
        "border-color": c.fg,
        "border-width": "data(bw)",
        "border-style": "data(bs)",
      },
    },
    { selector: "node.weak", style: { "border-color": c.muted } },
    { selector: "node.isolated", style: { "border-style": "dashed", "border-color": c.muted, color: c.muted, "background-color": c.bandA } },
    { selector: "node.others", style: { "border-width": 0, "background-opacity": 0, color: c.muted } },
    { selector: "node.guard", style: { "border-style": "dashed", "border-width": 2, "border-color": c.muted } },
    { selector: "node.lit", style: { "border-color": c.route, "border-width": 3 } },
    { selector: "node.current", style: { "background-color": c.route, color: c.bg, "border-color": c.route } },
    { selector: "node.dim", style: { opacity: 0.35 } },
    { selector: "node.picked", style: { "border-color": c.route, "border-width": 6, "background-color": c.route, "background-opacity": 0.18 } },
    { selector: "node.picked.current", style: { "background-color": c.route, "background-opacity": 1, color: c.bg } },
    { selector: "node.faded", style: { opacity: 0.12 } },
    { selector: "node.nolabel", style: { "text-opacity": 0 } },
    {
      selector: "edge",
      style: { width: NORMAL_EDGE.width, "line-style": NORMAL_EDGE.style, "line-color": c.muted, "curve-style": "bezier", "target-arrow-shape": "triangle", "target-arrow-color": c.muted, "arrow-scale": 0.8 },
    },
    {
      selector: "edge.conflict",
      style: {
        "line-color": c.danger,
        "target-arrow-color": c.danger,
        "target-arrow-shape": CONFLICT_EDGE.arrow,
        width: CONFLICT_EDGE.width,
        "line-style": CONFLICT_EDGE.style,
        "line-dash-pattern": CONFLICT_EDGE.dash,
      },
    },
    { selector: "edge.route", style: { "line-color": c.route, "target-arrow-color": c.route, width: 2.5 } },
    { selector: "edge.hidden", style: { display: "none" } },
  ]
}

function Legend({ map, now }: { map: EnvMapData; now: number }) {
  const items: { label: string; border: string }[] = [
    { label: "止める", border: "border-4 border-solid border-foreground" },
    { label: "判定する", border: "border-[5px] border-double border-foreground" },
    { label: "記録だけ", border: "border-2 border-dashed border-foreground" },
    { label: "読ませるだけ", border: "border-2 border-solid border-foreground" },
    { label: "強さなし", border: "border border-solid border-muted-foreground" },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm text-muted-foreground" aria-label="凡例">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <span className={`inline-block h-4 w-6 rounded-sm ${i.border}`} />
          {i.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-6 border-t-[3px] border-dashed" style={{ borderColor: "var(--destructive)" }} />
        食い違う決まり
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-1 w-6" style={{ background: "var(--flow-down)" }} />
        ルートの光
      </span>
      <span className="ml-auto">
        地図：箱 {map.nodes.length}・線 {map.edges.length}・
        {map.generatedAt === null ? "作成日は不明" : `作成 ${dateText(map.generatedAt)}（${agoText(map.generatedAt, now)}）`}
      </span>
    </div>
  )
}

interface PanelProps {
  map: EnvMapData
  nodes: Map<string, EnvMapNode>
  layerLabel: Map<string, string>
  selected: string | null
  setSelected: (id: string | null) => void
  ins: RouteInstruction | null
  reload: () => void
  /** 「つながり無し n」を押したとき・まとめた中の箱を選んだときに開く層 */
  openLayer: { id: string; scroll: boolean; n: number } | null
}

function DetailPanel({ map, nodes, layerLabel, selected, setSelected, ins, reload, openLayer }: PanelProps) {
  const [allSteps, setAllSteps] = useState(false)
  const listRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!openLayer || !listRef.current) return
    listRef.current.open = true
    if (openLayer.scroll) document.getElementById(`env-map-layer-${openLayer.id}`)?.scrollIntoView({ block: "start" })
  }, [openLayer])
  const sel = selected ? nodes.get(selected) : null
  const links = useMemo(() => {
    if (!sel) return []
    return map.edges
      .filter((e) => e.src === sel.id || e.dst === sel.id)
      .map((e) => ({ other: e.src === sel.id ? e.dst : e.src, out: e.src === sel.id, label: e.label, conflict: e.conflict }))
  }, [map, sel])
  const steps = ins?.steps ?? []
  const shown = allSteps ? steps : steps.slice(0, 30)
  return (
    <div className="space-y-4 py-2 text-sm">
      {sel && (
        <section aria-label="選んだ箱">
          <h3 className="font-medium">
            {sel.label}（{layerLabel.get(sel.layer) ?? sel.layer}
            {STRENGTH_TEXT[sel.strength] ? `・${STRENGTH_TEXT[sel.strength]}` : ""}）
          </h3>
          {sel.kind && <p className="text-muted-foreground">{sel.kind}</p>}
          {sel.place && <p className="break-all text-muted-foreground">置き場：{sel.place}</p>}
          {sel.desc && <p>{sel.desc}</p>}
          <ul className="mt-1 space-y-0.5">
            {links.map((l, i) => (
              <li key={i}>
                <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setSelected(l.other)}>
                  {l.out ? "→" : "←"} {nodes.get(l.other)?.label ?? l.other}
                </button>
                {l.label && <span className="text-muted-foreground">（{l.label}）</span>}
                {l.conflict && <span className="text-destructive">・食い違う決まり</span>}
              </li>
            ))}
            {links.length === 0 && <li className="text-muted-foreground">つながりはありません</li>}
          </ul>
        </section>
      )}
      {ins && steps.length > 0 && (
        <section aria-label="歩の一覧">
          <h3 className="font-medium">
            歩の一覧（時刻の順。続く同じ箱は1歩）{ins.agents > 0 ? "・役（サブエージェント）の中の道具は数えない" : ""}
          </h3>
          <ol className="mt-1 flex flex-wrap gap-1">
            {shown.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={`rounded border px-2 py-0.5 ${selected === s.box ? "border-[var(--flow-down)]" : ""}`}
                  onClick={() => setSelected(s.box)}
                >
                  {i + 1}. {shortName(nodes.get(s.box)?.label ?? s.box)}
                  {s.calls > 1 ? ` ×${s.calls}` : ""}
                </button>
              </li>
            ))}
          </ol>
          {steps.length > 30 && (
            <button type="button" className="mt-1 underline" onClick={() => setAllSteps((v) => !v)}>
              {allSteps ? "最初の30歩だけにする" : `残り ${steps.length - 30} 歩を出す`}
            </button>
          )}
        </section>
      )}
      <details ref={listRef}>
        <summary className="cursor-pointer">一覧で見る（層ごと。キーボードと読み上げ用）</summary>
        <div className="mt-2 space-y-2">
          {map.layers.map((l) => (
            <div key={l.id} id={`env-map-layer-${l.id}`}>
              <h4 className="font-medium">
                {l.label}（{map.nodes.filter((n) => n.layer === l.id).length}）
              </h4>
              <ul className="flex flex-wrap gap-1">
                {map.nodes
                  .filter((n) => n.layer === l.id)
                  .map((n) => (
                    <li key={n.id}>
                      <button type="button" className={`rounded border px-2 py-0.5 ${selected === n.id ? "border-[var(--flow-down)]" : ""}`} onClick={() => setSelected(n.id)}>
                        {n.label}
                        {n.degree === 0 ? "（つながり無し）" : ""}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
      <button type="button" className="text-muted-foreground underline" onClick={reload}>
        地図を読み直す
      </button>
    </div>
  )
}
