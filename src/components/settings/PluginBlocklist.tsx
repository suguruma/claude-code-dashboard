import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BlockedPlugin } from "@/lib/types"

interface PluginBlocklistProps {
  blockedPlugins: BlockedPlugin[]
}

export function PluginBlocklist({ blockedPlugins }: PluginBlocklistProps) {
  if (blockedPlugins.length === 0) {
    return <p className="text-sm text-muted-foreground">ブロック済みプラグインはありません。</p>
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {blockedPlugins.map((plugin, idx) => (
        <Card key={idx}>
          <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-mono">{plugin.plugin}</CardTitle>
            <Badge variant="outline">{plugin.reason}</Badge>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-sm text-muted-foreground">{plugin.text}</p>
            <p className="text-xs text-muted-foreground">追加日時: {plugin.added_at}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
