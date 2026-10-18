import { Card, CardContent } from "@/components/ui/card"
import { TradeOff } from "@/lib/types"

interface TradeOffCompareProps {
  conflictPoint: string
  tradeOffs: TradeOff[]
}

export function TradeOffCompare({ conflictPoint, tradeOffs }: TradeOffCompareProps) {
  return (
    <div className="space-y-3">
      <div className="text-sm">
        <span className="text-muted-foreground">対立点: </span>
        <span className="font-medium">{conflictPoint}</span>
      </div>
      {tradeOffs.map((t, idx) => (
        <div key={idx} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card className="border-blue-200 dark:border-blue-900">
            <CardContent className="pt-4">
              <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">案A</p>
              <p className="text-sm leading-relaxed">{t.option_a}</p>
            </CardContent>
          </Card>
          <Card className="border-amber-200 dark:border-amber-900">
            <CardContent className="pt-4">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">案B</p>
              <p className="text-sm leading-relaxed">{t.option_b}</p>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  )
}
