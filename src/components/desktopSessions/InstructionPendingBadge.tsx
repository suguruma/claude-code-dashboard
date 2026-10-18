import { Hourglass } from "lucide-react"
import { Badge } from "@/components/ui/badge"

/** 「最新の指示」が、起動直後の暫定の値であることを示す印。判定は isInstructionProvisional（src/lib/desktopInstruction.ts） */
export function InstructionPendingBadge() {
  return (
    <Badge
      variant="outline"
      className="shrink-0"
      title="会話ログを解析中です。人の指示が見つかると、表示が置き換わります"
    >
      <Hourglass aria-hidden />
      解析中
    </Badge>
  )
}
