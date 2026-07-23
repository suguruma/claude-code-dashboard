import { Progress } from "@/components/ui/progress"

interface ConsensusMeterProps {
  label: string
  value: number
}

export function ConsensusMeter({ label, value }: ConsensusMeterProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value}%</span>
      </div>
      <Progress value={value} />
    </div>
  )
}
