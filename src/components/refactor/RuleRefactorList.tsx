import { Badge } from "@/components/ui/badge"
import { RuleRefactorDiffItem } from "@/lib/types"

const TYPE_LABEL: Record<RuleRefactorDiffItem["type"], string> = {
  modify: "修正",
  merge: "統合",
  remove: "削除",
}

const TYPE_STYLES: Record<RuleRefactorDiffItem["type"], string> = {
  modify: "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
  merge: "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-400",
  remove: "border-destructive/40 text-destructive",
}

interface RuleRefactorListProps {
  items: RuleRefactorDiffItem[]
  selectedIndexes: Set<number>
  onToggle: (index: number) => void
}

export function RuleRefactorList({ items, selectedIndexes, onToggle }: RuleRefactorListProps) {
  if (items.length === 0) return null

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const checked = selectedIndexes.has(item.index)
        const stale = item.status === "stale"
        return (
          <div key={item.index} className="rounded-md border p-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-primary"
                checked={checked}
                disabled={stale}
                onChange={() => onToggle(item.index)}
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-mono text-sm">{item.targetCategory}</span>
                  <Badge variant="outline" className={TYPE_STYLES[item.type]}>
                    {TYPE_LABEL[item.type]}
                  </Badge>
                  {item.sourceCategories.length > 1 && (
                    <span className="text-xs text-muted-foreground">
                      統合元：{item.sourceCategories.join("、")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">理由：{item.reason}</p>
                {stale && (
                  <p className="text-xs text-destructive">{item.staleReason}</p>
                )}
                {!stale && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">現在の内容</p>
                      <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                        {item.before}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">
                        {item.type === "remove" ? "削除後" : "適用後の内容"}
                      </p>
                      <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                        {item.type === "remove" ? "（見出しごと削除されます）" : item.after}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
