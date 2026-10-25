"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, RefreshCw, TriangleAlert } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useOrgRules } from "@/hooks/useOrgRules"
import { useProjects } from "@/hooks/useProjects"
import type { OrgRulesResponse } from "@/lib/orgRulesTypes"
import { MemoryBrowser } from "@/components/memory/MemoryBrowser"
import { MemoryList } from "./MemoryList"
import { RuleFileView } from "./RuleFileView"

const SECTION = "space-y-3 rounded-xl p-4 ring-1 ring-foreground/10"

/** 組織の「決まり」(⑨)の本体。B(全体)→ C(グループごと)→ D(追加のファイル)→ 記憶の一覧(⑬ でまとめた)の順に並べる */
export function OrgRulesView() {
  const { data, error, isLoading, isValidating, reload } = useOrgRules()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => reload()} disabled={isValidating}>
          <RefreshCw className={`size-4 ${isValidating ? "animate-spin" : ""}`} aria-hidden />
          読み直す
        </Button>
        {data && <StaleSummary data={data} />}
      </div>

      {error && !data && (
        <Alert variant="destructive">
          <AlertTitle>読み込みエラー</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      {isLoading && !data && <p className="text-sm text-muted-foreground">読み込み中...</p>}

      {data && (
        <>
          <section id="org-global" className={SECTION} aria-labelledby="org-global-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="org-global-title" className="text-base font-semibold">
                全体の決まり（グローバルの CLAUDE.md）
              </h2>
              <EditGlobalButton />
            </div>
            <p className="text-xs text-muted-foreground">すべてのセッションに効く決まりです。「組織の運用」「セッションの題名」の節を先頭に出します。</p>
            <RuleFileView file={data.global} missingText="グローバルの CLAUDE.md がありません。" testId="org-global-file" />
          </section>

          <section id="org-folders" className={SECTION} aria-labelledby="org-folders-title">
            <h2 id="org-folders-title" className="text-base font-semibold">
              グループごとの決まり（指揮役の作業フォルダ）
            </h2>
            <p className="text-xs text-muted-foreground">
              グループごとの指揮役（組織図と同じ）の作業フォルダの CLAUDE.md と、記憶の一覧です。記憶は作業フォルダごとに保存されるので、同じ作業フォルダの指揮役が複数のグループにいるときは、1枚にまとめます。
            </p>
            {data.foldersStatus === "no-desktop" ? (
              <p className="text-sm text-muted-foreground">Claude Desktop のデータが見つからないため、指揮役を探せません。</p>
            ) : data.folders.length === 0 ? (
              <p className="text-sm text-muted-foreground">指揮役のいるグループがありません。</p>
            ) : (
              <div className="space-y-4">
                {data.folders.map((folder) => (
                  <div key={folder.key} className="space-y-3 rounded-lg border p-3" data-testid="org-folder">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        この作業フォルダの決まりが効くグループ：
                        {folder.groups.map((g) => g.groupName).join("・")}
                      </p>
                      <ul className="flex flex-wrap gap-1.5">
                        {folder.groups.map((g) => (
                          <li key={`${g.groupName}:${g.leaderTitle}`}>
                            <Badge variant="outline">
                              {g.groupName}：{g.leaderTitle}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                      <p className="font-mono text-xs break-all text-muted-foreground">{folder.cwd}</p>
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold">作業フォルダの CLAUDE.md</h3>
                      <RuleFileView file={folder.claudeMd} missingText="この作業フォルダに CLAUDE.md はありません。" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold">記憶</h3>
                      <MemoryList folderKey={folder.key} memory={folder.memory} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section id="org-extras" className={SECTION} aria-labelledby="org-extras-title">
            <h2 id="org-extras-title" className="text-base font-semibold">
              追加のファイル
            </h2>
            {data.extras.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                設定ファイル config/org-rules.json の extraFiles に書くと、台帳などのファイルを足せます（.md と .txt、1MB まで）。
              </p>
            ) : (
              <div className="space-y-4">
                {data.extras.map((extra, i) => (
                  <div key={`${i}:${extra.label}`} className="space-y-1" data-testid="org-extra">
                    <h3 className="text-sm font-semibold">{extra.label}</h3>
                    <RuleFileView file={extra.file} missingText="見つかりません。" />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 記憶の一覧(⑬ でメモリ管理のページからまとめた。/memory はここへ移る) */}
          <section id="org-memory" className={SECTION} aria-labelledby="org-memory-title">
            <h2 id="org-memory-title" className="text-base font-semibold">
              記憶の一覧（選んでいるプロジェクト）
            </h2>
            <MemoryBrowser />
          </section>
        </>
      )}
    </div>
  )
}

/** 古いセッション名の印の合計と、各節への移動 */
function StaleSummary({ data }: { data: OrgRulesResponse }) {
  if (!data.staleChecked) {
    return <p className="text-xs text-muted-foreground">Claude Desktop のデータが無いため、古いセッション名は調べていません。</p>
  }
  if (data.staleTotal === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="stale-total">
        今の題名と合わないセッション名はありません。
      </p>
    )
  }
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="stale-total">
      <span className="inline-flex items-center gap-1 font-medium" style={{ color: "var(--status-warning-text)" }}>
        <TriangleAlert className="size-4" aria-hidden />
        古いセッション名の疑い {data.staleTotal}件
      </span>
      <a href="#org-global" className="text-xs underline underline-offset-2">
        全体の決まり
      </a>
      <a href="#org-folders" className="text-xs underline underline-offset-2">
        グループごとの決まり
      </a>
      <a href="#org-extras" className="text-xs underline underline-offset-2">
        追加のファイル
      </a>
    </p>
  )
}

/**
 * 「ルール管理で編集する」(Q8)。グローバル設定(~/.claude)のプロジェクトが登録されていれば、それを選んでからルール管理を開く
 * (書き込みは、いまのプロジェクトの選択だけ)。登録されていなければ、登録のしかたを案内する
 */
function EditGlobalButton() {
  const { projects, selectProject } = useProjects()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const global = projects.find((p) => p.isGlobalConfig)
  if (!global) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="edit-global-guide">
        ルール管理などの右上の「+」で ~/.claude を登録すると、ルール管理で編集できます。
      </p>
    )
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await selectProject(global.id)
          router.push("/rules")
        } finally {
          setBusy(false)
        }
      }}
    >
      <Pencil className="size-4" aria-hidden />
      ルール管理で編集する
    </Button>
  )
}
