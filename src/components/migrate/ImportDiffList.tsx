import { Badge } from "@/components/ui/badge"
import { getCategoryMeta } from "@/lib/skillCategories"
import { ImportDiffItem, ImportItemStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

function categoryLabel(category: string | null | undefined): string {
  const meta = getCategoryMeta(category ?? undefined)
  return `${meta.emoji} ${meta.label}`
}

const STATUS_LABEL: Record<ImportItemStatus, string> = {
  new: "新規",
  changed: "変更あり",
  unchanged: "変更なし",
  invalid: "不正",
}

const STATUS_STYLES: Record<ImportItemStatus, string> = {
  new: "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400",
  changed: "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
  unchanged: "border-border text-muted-foreground",
  invalid: "border-destructive/40 text-destructive",
}

export function itemKey(item: Pick<ImportDiffItem, "kind" | "key">): string {
  return `${item.kind}:${item.key}`
}

interface ImportDiffListProps {
  title: string
  items: ImportDiffItem[]
  selectedKeys: Set<string>
  onToggle: (item: ImportDiffItem) => void
}

export function ImportDiffList({ title, items, selectedKeys, onToggle }: ImportDiffListProps) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => {
          const key = itemKey(item)
          const checked = selectedKeys.has(key)
          return (
            <div key={key} className="rounded-md border p-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
                  checked={checked}
                  disabled={item.status === "invalid"}
                  onChange={() => onToggle(item)}
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm">{item.key}</span>
                    <Badge variant="outline" className={cn("shrink-0", STATUS_STYLES[item.status])}>
                      {STATUS_LABEL[item.status]}
                    </Badge>
                  </div>
                  {item.status === "invalid" && (
                    <p className="text-xs text-destructive">
                      スキル名の形式が不正なためインポートできません（半角英数字・ハイフン・アンダースコアのみ有効）
                    </p>
                  )}
                  {item.kind === "skill" &&
                    item.categoryBefore !== undefined &&
                    item.categoryAfter !== undefined &&
                    item.categoryBefore !== item.categoryAfter && (
                      <p className="text-xs text-muted-foreground">
                        カテゴリ：
                        {item.status === "new"
                          ? categoryLabel(item.categoryAfter)
                          : `${categoryLabel(item.categoryBefore)} → ${categoryLabel(item.categoryAfter)}`}
                      </p>
                    )}
                  {item.kind === "skill" &&
                    item.titleBefore !== undefined &&
                    item.titleAfter !== undefined &&
                    item.titleBefore !== item.titleAfter && (
                      <p className="text-xs text-muted-foreground">
                        表示名：
                        {item.status === "new"
                          ? (item.titleAfter ?? "未設定")
                          : `${item.titleBefore ?? "未設定"} → ${item.titleAfter ?? "未設定"}`}
                      </p>
                    )}
                  {item.kind === "skill" &&
                    item.targetModelBefore !== undefined &&
                    item.targetModelAfter !== undefined &&
                    item.targetModelBefore !== item.targetModelAfter && (
                      <p className="text-xs text-muted-foreground">
                        対象モデル：
                        {item.status === "new"
                          ? (item.targetModelAfter ?? "未設定")
                          : `${item.targetModelBefore ?? "未設定"} → ${item.targetModelAfter ?? "未設定"}`}
                      </p>
                    )}
                  {item.status === "changed" && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-xs text-muted-foreground">現在の内容</p>
                        <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                          {item.before}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1 text-xs text-muted-foreground">インポート後の内容</p>
                        <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                          {item.after}
                        </pre>
                      </div>
                    </div>
                  )}
                  {item.status === "new" && (
                    <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                      {item.after}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
