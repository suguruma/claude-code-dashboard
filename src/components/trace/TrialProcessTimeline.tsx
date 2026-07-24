import { AlertTriangle, CheckCircle2, RotateCcw, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { TrialStep } from "@/lib/types"

const RESULT_STYLE: Record<TrialStep["result"], { icon: LucideIcon; box: string; icon_className: string }> = {
  success: { icon: CheckCircle2, box: "border-transparent", icon_className: "text-muted-foreground" },
  retry: {
    icon: RotateCcw,
    box: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
    icon_className: "text-amber-600 dark:text-amber-400",
  },
  error: {
    icon: AlertTriangle,
    box: "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
    icon_className: "text-red-600 dark:text-red-400",
  },
}

interface TrialProcessTimelineProps {
  steps: TrialStep[]
}

export function TrialProcessTimeline({ steps }: TrialProcessTimelineProps) {
  if (steps.length === 0) return null

  const sorted = [...steps].sort((a, b) => a.step - b.step)

  return (
    <ol className="space-y-1.5">
      {sorted.map((s) => {
        const style = RESULT_STYLE[s.result]
        const Icon = style.icon
        const isProblem = s.result !== "success"
        return (
          <li
            key={s.step}
            className={cn("flex items-start gap-2 rounded-md border p-2 text-sm", style.box)}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", style.icon_className)} />
            <div className="space-y-0.5">
              <p className="leading-snug">
                <span className="text-xs text-muted-foreground">Step {s.step}: </span>
                {s.action}
              </p>
              {isProblem && s.note && (
                <p className="text-xs text-red-600/90 dark:text-red-400/90">{s.note}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
