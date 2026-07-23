import { Cpu } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export default function RefactorPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">ルール矛盾・重複自動検出（GPUモード）</h1>
        <p className="text-sm text-muted-foreground mt-1">機能3 / Phase4 に相当します</p>
      </div>
      <Alert>
        <Cpu className="size-4" />
        <AlertTitle>今回のスコープ外・次回実装予定</AlertTitle>
        <AlertDescription>
          Ollama等のローカルLLMと接続し、rules.json
          全件を解析して矛盾・重複ルールを検出、統合案をDiff表示・ワンクリック適用する機能です。
          今回は機能1・機能2（CPUモード）を優先実装したため未実装です。
        </AlertDescription>
      </Alert>
    </div>
  )
}
