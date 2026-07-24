import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface ExportPanelProps {
  exportUrl: string
}

export function ExportPanel({ exportUrl }: ExportPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">エクスポート</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          現在のプロジェクトのルール（CLAUDE.md）とスキル（skills/*/SKILL.md）を1つのJSONファイルにまとめてダウンロードします。
          settings.jsonの権限モードや環境変数など、個人環境依存の設定は含まれません。
        </p>
        <Button nativeButton={false} render={<a href={exportUrl} download />}>
          エクスポート
        </Button>
      </CardContent>
    </Card>
  )
}
