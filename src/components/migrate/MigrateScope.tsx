import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MIGRATE_EXCLUDED, MIGRATE_IMPORT_NOTE, MIGRATE_INCLUDED } from "@/lib/migrateScope"

/** 移行で移るもの・移らないもの(エクスポートとインポートの上に出す) */
export function MigrateScope() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">移るもの・移らないもの</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="font-medium">移る</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {MIGRATE_INCLUDED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium">移らない</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {MIGRATE_EXCLUDED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="text-muted-foreground">{MIGRATE_IMPORT_NOTE}</p>
      </CardContent>
    </Card>
  )
}
