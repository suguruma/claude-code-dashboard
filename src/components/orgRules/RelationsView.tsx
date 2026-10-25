"use client"

import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { STATUS_META } from "@/components/desktopSessions/statusMeta"
import { useRelations } from "@/hooks/useRelations"
import type { DesktopSessionStatus } from "@/lib/desktopSessionTypes"
import { formatDuration } from "@/lib/housekeepingFormat"
import { deliveryText, type RelationSession, type RelationsResponse, type RoleLabels } from "@/lib/relationsTypes"
import {
  coverageLine,
  defaultSelection,
  effectRows,
  formatWhen,
  groupMeta,
  ledgerLine,
  orderCards,
  splitCards,
} from "@/lib/relationsView"

const SECTION = "space-y-3 rounded-xl p-4 ring-1 ring-foreground/10"
const PHRASE = "[word-break:auto-phrase]"
const WARN = { color: "var(--status-warning-text)" }

/**
 * 関係性マップ(⑬ 組織の「つながり」。RM-1〜RM-8)。グループの一覧で1つを選ぶと、そのグループだけを開く(M10)。
 * 線で結ばず、カードの文で示す(L4)。データの無い行はカードに書かない(N3)。読み取り専用。
 */
export function RelationsView() {
  const { data, error, isLoading, isValidating, reload } = useRelations()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" className="text-sm" onClick={() => reload()} disabled={isValidating}>
          <RefreshCw className={`size-4 ${isValidating ? "animate-spin" : ""}`} aria-hidden />
          読み直す
        </Button>
      </div>

      {error && !data && (
        <Alert variant="destructive">
          <AlertTitle>つながりを読み込めませんでした</AlertTitle>
          <AlertDescription>
            <Button variant="outline" size="sm" className="text-sm" onClick={() => reload()}>
              もう一度読み込む
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {isLoading && !data && <p className="text-sm text-muted-foreground">読み込み中...</p>}
      {data && data.status === "no-desktop" && (
        <p className="text-sm text-muted-foreground">Claude Desktop のデータが見つからないため、グループが分かりません。</p>
      )}
      {data && data.status === "ok" && data.groups.length === 0 && <p className="text-sm text-muted-foreground">セッションがありません。</p>}
      {data && data.status === "ok" && data.groups.length > 0 && <RelationsBody data={data} />}
    </div>
  )
}

function RelationsBody({ data }: { data: RelationsResponse }) {
  const [groupId, setGroupId] = useState<string>(data.groups[0].id)
  const group = data.groups.find((g) => g.id === groupId) ?? data.groups[0]
  const members = useMemo(
    () => orderCards(data.sessions.filter((s) => (s.groupId ?? "none") === group.id)),
    [data.sessions, group.id]
  )
  const [picked, setPicked] = useState<Record<string, string>>({})
  const selectedId = picked[group.id] ?? defaultSelection(members)
  const selected = members.find((s) => s.id === selectedId) ?? null
  const titleOf = useMemo(() => new Map(data.sessions.map((s) => [s.id, s.title])), [data.sessions])

  return (
    <div className="grid gap-4 xl:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="グループ">
        <ul className="flex flex-wrap gap-2 xl:flex-col">
          {data.groups.map((g) => {
            const active = g.id === group.id
            return (
              <li key={g.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setGroupId(g.id)}
                  data-testid="relations-group"
                  className={`min-h-11 w-full rounded-lg border px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted"
                  }`}
                >
                  <span className="block text-sm font-semibold">{g.name}</span>
                  <span className="block text-sm text-muted-foreground">{groupMeta(g)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className={`${SECTION} min-w-0 space-y-6`}>
        <section aria-labelledby="relations-org-title" className="space-y-3">
          <h2 id="relations-org-title" className="text-base font-semibold">
            {group.name} の組織 <span className="text-sm font-normal text-muted-foreground">{members.length}件</span>
          </h2>
          <p className="text-sm text-muted-foreground">{coverageLine(members)}</p>
          <OrgCards
            key={group.id}
            members={members}
            roleLabels={data.roleLabels}
            titleOf={titleOf}
            selectedId={selected?.id ?? null}
            onSelect={(id) => setPicked((p) => ({ ...p, [group.id]: id }))}
            now={data.generatedAt}
          />
          <p className="text-sm text-muted-foreground">
            線で結ばず、カードの文で示します。「立てた」は Desktop の立てた記録があるときだけ書きます。役割は題名の決まり（設定で変えられます）だけで分けます。
            {data.roleLabels.helper}が確かめている相手は、記録が無いので出しません。
          </p>
        </section>

        <EffectsTable data={data} members={members} selected={selected} />

        <CrossGroupTable data={data} groupId={group.id} titleOf={titleOf} />
      </div>
    </div>
  )
}

function OrgCards({
  members,
  roleLabels,
  titleOf,
  selectedId,
  onSelect,
  now,
}: {
  members: RelationSession[]
  roleLabels: RoleLabels
  titleOf: Map<string, string>
  selectedId: string | null
  onSelect: (id: string) => void
  now: number
}) {
  const [expanded, setExpanded] = useState(false)
  const leaders = members.filter((s) => s.role === "leader")
  const others = members.filter((s) => s.role !== "leader")
  const { shown, hidden } = splitCards(others, expanded)
  const card = (s: RelationSession) => (
    <SessionCard
      key={s.id}
      session={s}
      roleLabels={roleLabels}
      titleOf={titleOf}
      members={members}
      selected={s.id === selectedId}
      onSelect={() => onSelect(s.id)}
      now={now}
    />
  )

  return (
    <div className="space-y-3">
      {leaders.length > 0 && <div className="grid gap-3 lg:grid-cols-2">{leaders.map(card)}</div>}
      {shown.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{shown.map(card)}</div>}
      {hidden.length > 0 && (
        <Button variant="ghost" size="sm" className="min-h-11 text-sm" onClick={() => setExpanded(true)}>
          ほか {hidden.length}件を出す（{hidden.slice(0, 3).map((s) => s.title).join("・")}
          {hidden.length > 3 ? "…" : ""}）
        </Button>
      )}
    </div>
  )
}

function SessionCard({
  session: s,
  roleLabels,
  titleOf,
  members,
  selected,
  onSelect,
  now,
}: {
  session: RelationSession
  roleLabels: RoleLabels
  titleOf: Map<string, string>
  members: RelationSession[]
  selected: boolean
  onSelect: () => void
  now: number
}) {
  // 判断材料の無い「不明」は書かない(データの無い行はカードに書かない。N3)
  const status = s.status === "unknown" ? null : STATUS_META[s.status as DesktopSessionStatus]?.label ?? null
  const parent = s.spawnedFromId ? titleOf.get(s.spawnedFromId) ?? null : null
  const spawned = members.filter((m) => m.spawnedFromId === s.id)
  const ledger = ledgerLine(s.orders, s.reports, now)
  const same = s.sameFolderIds.map((id) => titleOf.get(id)).filter((t): t is string => !!t)
  const helper = s.role === "helper"

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      data-testid="relations-card"
      data-role={s.role}
      className={`min-w-0 rounded-lg border p-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        helper ? "border-dashed" : ""
      } ${selected ? "border-2 border-solid border-primary" : "hover:bg-muted/50"}`}
    >
      <span className={`block font-semibold ${PHRASE}`}>{s.title}</span>
      <span className={`block ${PHRASE}`}>
        {roleLabels[s.role]}
        {parent ? `（${parent} が立てた）` : ""}
        {status ? `・${status}` : ""}
      </span>
      {s.folderName && <span className={`block ${PHRASE}`}>作業フォルダ：{s.folderName}</span>}
      {s.branch && <span className={`block ${PHRASE}`}>ブランチ：{s.branch}</span>}
      {ledger && (
        <span className={`block ${PHRASE}`}>
          {ledger.text}
          {ledger.waiting && (
            <>
              {" → "}
              <strong style={WARN}>{ledger.waiting}</strong>
            </>
          )}
        </span>
      )}
      {spawned.length > 0 && (
        <span className={`block ${PHRASE}`}>立てたセッション：{spawned.map((m) => m.title).join("・")}</span>
      )}
      {same.length > 0 && (
        <strong className={`block ${PHRASE}`} style={WARN}>
          同じ作業フォルダ：{same.join("・")}
        </strong>
      )}
    </button>
  )
}

function EffectsTable({ data, members, selected }: { data: RelationsResponse; members: RelationSession[]; selected: RelationSession | null }) {
  const rows = effectRows(data, members, selected)
  const now = data.generatedAt
  return (
    <section aria-labelledby="relations-effects-title" className="space-y-2">
      <h2 id="relations-effects-title" className="text-base font-semibold">
        効いている決まり・記憶・スキル・指示ファイル{" "}
        {selected && <span className="text-sm font-normal text-muted-foreground">選んだセッション：{selected.title}</span>}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">種類</th>
              <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">何か</th>
              <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">効く先</th>
              <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">最終更新</th>
              <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">このセッションに</th>
              <th scope="col" className="whitespace-nowrap py-2 font-medium">ここで判断すること</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b align-top" data-testid="relations-effect">
                <td className={`py-2 pr-3 ${PHRASE}`}>{r.kind}</td>
                <td className={`py-2 pr-3 ${PHRASE}`}>{r.what}</td>
                <td className={`py-2 pr-3 ${PHRASE}`}>{r.target}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{r.updatedAt === null ? "—" : formatWhen(r.updatedAt, now)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{r.forSelected}</td>
                <td className={`py-2 ${PHRASE}`}>{r.decide}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">
        効く先は、推さずに決められる出どころだけで出します：全体の決まり＝全セッション、作業フォルダの決まり＝作業フォルダとその上のフォルダの CLAUDE.md、記憶＝そのセッションの会話ログの置き場、スキル＝呼び出しの記録、指示ファイル＝設定（config/relations.json）で結んだ担当。
        {data.effects.cloudSkipped > 0 && ` クラウドのフォルダにある作業フォルダ ${data.effects.cloudSkipped}件は、中を調べていません。`}
      </p>
    </section>
  )
}

function CrossGroupTable({ data, groupId, titleOf }: { data: RelationsResponse; groupId: string; titleOf: Map<string, string> }) {
  const rows = data.crossGroup.filter((r) => (r.fromGroupId ?? "none") === groupId || (r.toGroupId ?? "none") === groupId)
  const now = data.generatedAt
  const days = Math.round(data.crossWindowMs / (24 * 60 * 60_000))
  return (
    <section aria-labelledby="relations-cross-title" className="space-y-2">
      <h2 id="relations-cross-title" className="text-base font-semibold">
        グループをまたぐ頼み <span className="text-sm font-normal text-muted-foreground">直近{days}日</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">このグループのグループをまたぐ頼みはありません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">誰 → 誰</th>
                <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">要旨（先頭20字）</th>
                <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">送った</th>
                <th scope="col" className="whitespace-nowrap py-2 font-medium">返事</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const unanswered = r.repliedAt === null
                return (
                  <tr key={`${r.fromId}:${r.toId}:${r.sentAt ?? i}`} className="border-b align-top" data-testid="relations-cross">
                    <td className={`py-2 pr-3 ${PHRASE}`}>
                      {titleOf.get(r.fromId) ?? "—"} → {titleOf.get(r.toId) ?? "—"}
                    </td>
                    <td className={`py-2 pr-3 ${PHRASE}`}>{r.summary ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatWhen(r.sentAt, now)}</td>
                    <td className={`py-2 ${PHRASE}`}>
                      {unanswered ? (
                        <strong style={WARN}>
                          {deliveryText(r)}
                          {r.sentAt !== null ? `（${formatDuration(now - r.sentAt)}）` : ""}
                        </strong>
                      ) : (
                        deliveryText(r)
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
