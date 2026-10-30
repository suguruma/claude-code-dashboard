import { AlertTriangle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { getCategoryMeta } from "@/lib/skillCategories"
import { SimilarSkillPair } from "@/lib/types"

interface SimilarSkillsAlertProps {
  pairs: SimilarSkillPair[]
}

export function SimilarSkillsAlert({ pairs }: SimilarSkillsAlertProps) {
  if (pairs.length === 0) return null

  // 数が増えたときだけ役立つので、初めは閉じておく(⑬ の棚卸しの行33。設定の項目は作らない)
  return (
    <Alert className="border-amber-300 dark:border-amber-800">
      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle>発火が曖昧かもしれないスキルの組（{pairs.length}組）</AlertTitle>
      <AlertDescription>
        <details data-testid="similar-skills">
        <summary className="cursor-pointer">開いて読む</summary>
        <p className="mb-2 text-muted-foreground">
          同カテゴリ内でdescriptionの内容が似ているスキルです。Claude
          Codeがどちらを発火すべきか判断しづらくなっている可能性があります。
        </p>
        <ul className="space-y-1.5">
          {pairs.map((pair) => (
            <li
              key={`${pair.dirNameA}-${pair.dirNameB}`}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400">
                類似度 {Math.round(pair.score * 100)}%
              </Badge>
              <span className="font-mono">{pair.labelA}</span>
              <span className="text-muted-foreground">⇔</span>
              <span className="font-mono">{pair.labelB}</span>
              <span className="text-xs text-muted-foreground">
                （{getCategoryMeta(pair.category || undefined).label}）
              </span>
            </li>
          ))}
        </ul>
        </details>
      </AlertDescription>
    </Alert>
  )
}
