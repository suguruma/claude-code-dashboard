import { AlertTriangle } from "lucide-react"
import { UserIntervention } from "@/lib/types"

interface InterventionCardProps {
  intervention: UserIntervention
}

export function InterventionCard({ intervention }: InterventionCardProps) {
  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
      <div className="flex items-start gap-2">
        <AlertTriangle className="size-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-red-700 dark:text-red-300">
            Step {intervention.step}: 「{intervention.user_input}」
          </p>
          <p className="text-red-600/90 dark:text-red-400/90 text-xs">
            原因分析: {intervention.cause_analysis}
          </p>
        </div>
      </div>
    </div>
  )
}
