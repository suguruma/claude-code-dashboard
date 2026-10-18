import { orderMembers, type MemberOrder } from "./flowOrder"

/**
 * 組織図(⑤)の木の作り方。DOM・fsに触れない純粋な関数だけを置く(サーバー・画面の両方から使う)。
 *
 * 親子の根拠は、Desktopのメタデータの `spawnedFrom.sessionId`(そのセッションを作ったセッション)だけ。
 * フォーク・作業フォルダ・タイトルの付け方は使わない。
 *
 * 層: 1層目=指揮役 / 2層目=指揮役の子 / 3層目=2層目の子が作った補助のセッション(例: 会話の練習相手)。
 * 4層目以降は別の層として描かず、2層目の祖先の下に、3層目としてまとめて並べる。
 */

/** 木に入れる候補のセッション(指揮役を除く) */
export interface TreeSession {
  id: string
  /** 作成日時(ms)。分からなければ null */
  createdAt: number | null
  /** そのセッションを作ったセッションのID(`spawnedFromId`)。無ければ null */
  parentId: string | null
  /** グループ内のセッションか。false は、どのグループにも入っていない候補(3層目に出る可能性がある) */
  inGroup: boolean
}

export interface TreePlacement {
  id: string
  /** 2: 指揮役の子 / 3: 2層目の子が作ったセッション */
  depth: 2 | 3
  /** 描く線の上端になる親。2層目は指揮役、3層目は2層目のセッション(4層目以降は、2層目の祖先) */
  parentId: string
}

export interface PlaceInput {
  leaderId: string
  /** 指揮役を除く候補。グループ内のセッションと、グループ外の候補(親を持つもの) */
  sessions: TreeSession[]
}

/** 作成日時の古い順(分からないものは後ろ)、同じなら ID の順 */
function earlier(a: TreeSession, b: TreeSession): number {
  const ta = a.createdAt ?? Number.POSITIVE_INFINITY
  const tb = b.createdAt ?? Number.POSITIVE_INFINITY
  if (ta !== tb) return ta < tb ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

interface Chain {
  /** 自分から、親をたどった順のセッション(木の候補の中にいるものだけ) */
  nodes: TreeSession[]
  /** たどった先が指揮役だったか */
  reachedLeader: boolean
}

/**
 * 親をたどる。指揮役に着いたら止まる(指揮役自身の親は見ない)。親が候補に無ければ、そこで止まる。
 * 親の連鎖が輪になっていたら、輪の中で最も古いセッションを先頭(根)として止まる(同じ輪の中のセッションは、どこから
 * たどっても同じ根になるので、互いを親にしあうことはない)。
 */
function chainOf(startId: string, byId: Map<string, TreeSession>, leaderId: string): Chain {
  const nodes: TreeSession[] = []
  const index = new Map<string, number>()
  let current = byId.get(startId)
  while (current) {
    const seen = index.get(current.id)
    if (seen !== undefined) {
      const root = nodes.slice(seen).sort(earlier)[0]
      return { nodes: nodes.slice(0, nodes.indexOf(root) + 1), reachedLeader: false }
    }
    index.set(current.id, nodes.length)
    nodes.push(current)
    if (current.parentId === leaderId) return { nodes, reachedLeader: true }
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return { nodes, reachedLeader: false }
}

/**
 * 各セッションが木のどこに出るかを決める。木に出さないセッションは、結果に含めない。
 *
 * - 親が指揮役のセッションは、グループの内外を問わず2層目。
 * - グループ内のセッションは、親が木に無ければ(親が無い・グループ外・別のグループ)、2層目。
 *   親が、グループ内の別のセッション(2層目)なら、その3層目。
 * - グループ外のセッションは、親をたどって2層目のセッションに着くときだけ、その3層目。着かなければ出さない。
 * - 親の親をたどって4層目以降になるものは、2層目の祖先の3層目にする。
 * - 親の連鎖が輪になっていても止まる。
 *
 * 結果は、作成日時の古い順(同じなら ID の順)。
 */
export function placeOrgTree({ leaderId, sessions }: PlaceInput): TreePlacement[] {
  const byId = new Map(sessions.filter((s) => s.id !== leaderId).map((s) => [s.id, s] as const))
  const placements: Array<{ session: TreeSession; placement: TreePlacement }> = []

  for (const session of byId.values()) {
    const { nodes: whole, reachedLeader } = chainOf(session.id, byId, leaderId)
    let nodes = whole
    // 指揮役に着かなかった連鎖の根がグループ外のセッションなら、それは木に無い。根から順に外す
    if (!reachedLeader) {
      while (nodes.length > 0 && !nodes[nodes.length - 1].inGroup) nodes = nodes.slice(0, -1)
    }
    if (nodes.length === 0) continue
    const root = nodes[nodes.length - 1]
    placements.push({
      session,
      placement: root.id === session.id ? { id: session.id, depth: 2, parentId: leaderId } : { id: session.id, depth: 3, parentId: root.id },
    })
  }

  return placements.sort((a, b) => earlier(a.session, b.session)).map((p) => p.placement)
}

/** 画面用: 組織図のカードの層。指揮役=1、指揮役の子=2、3層目=3(親が指揮役以外) */
export function memberDepth(member: { isLeader: boolean; parentId: string | null }, leaderId: string | null): 1 | 2 | 3 {
  if (member.isLeader) return 1
  return member.parentId !== null && member.parentId !== leaderId ? 3 : 2
}

/** 画面で木に並べる対象(カードの元になる値)。member は API の FlowMember のうち、並べるのに使う項目 */
export interface ArrangeNode {
  member: { id: string; title: string; isLeader: boolean; parentId: string | null }
}

/**
 * 画面に出す並び順: 2層目(指揮役の子)の並びと、2層目ごとの3層目の並び。指揮役は含まない。
 * 並び順(名前順・作成順)は、2層目にも3層目にも同じ規則で使う。`nodes` は作成順で渡す。
 */
export function arrangeTree<T extends ArrangeNode>(
  nodes: readonly T[],
  options: { leaderId: string | null; order: MemberOrder }
): { children: T[]; subs: Record<string, T[]> } {
  const { leaderId, order } = options
  const byTitle = (n: T) => n.member.title
  const rest = nodes.filter((n) => !n.member.isLeader)
  const subs: Record<string, T[]> = {}
  for (const n of rest) {
    if (memberDepth(n.member, leaderId) === 3 && n.member.parentId) (subs[n.member.parentId] ??= []).push(n)
  }
  for (const parentId of Object.keys(subs)) subs[parentId] = orderMembers(subs[parentId], order, byTitle)
  return {
    children: orderMembers(
      rest.filter((n) => memberDepth(n.member, leaderId) === 2),
      order,
      byTitle
    ),
    subs,
  }
}
