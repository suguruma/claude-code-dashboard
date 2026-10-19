"use client"

import { useEffect, useState } from "react"
import { QrCode, ShieldAlert, Smartphone } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { formatDateTime } from "@/components/desktopSessions/format"
import { useLanAccess } from "@/hooks/useLanAccess"
import type { PublicLanDevice } from "@/lib/lanAccess/devices"
import type { IssuedPairing } from "@/lib/lanAccess/service"

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** スマホから見る(⑪)の PC の画面。オン・オフ、待ち受けの状態、登録コード(QR と文字)、端末の一覧と取り消し */
export function LanAccessView() {
  const { data, error, isLoading, setEnabled, issuePairing, revoke, rename } = useLanAccess()
  const [busy, setBusy] = useState(false)
  const [pairing, setPairing] = useState<IssuedPairing | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [revoking, setRevoking] = useState<PublicLanDevice | null>(null)

  // 登録コードの残り時間を1秒ごとに進める。期限が過ぎたら、画面から消す(コードは保存しない)
  useEffect(() => {
    if (!pairing) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pairing])
  const remainingMs = pairing ? pairing.expiresAt - now : 0
  // 期限が過ぎた・スマホで登録が済んだ(有効なコードが無くなった)・オフにしたときは、コードを出さない
  const shown = pairing && remainingMs > 0 && data?.pairing.active && data.enabled ? pairing : null

  if (isLoading) return <p className="text-sm text-muted-foreground">読み込み中...</p>
  if (error || !data) {
    return (
      <Alert>
        <AlertTitle>設定を読めませんでした</AlertTitle>
        <AlertDescription>{errorText(error, "しばらくしてから開き直してください")}</AlertDescription>
      </Alert>
    )
  }

  const listening = data.enabled && data.status.state === "listening"

  async function toggle(next: boolean) {
    setBusy(true)
    try {
      await setEnabled(next)
      if (!next) setPairing(null)
    } catch (err) {
      toast.error(errorText(err, "切り替えられませんでした"))
    } finally {
      setBusy(false)
    }
  }

  async function issue() {
    setBusy(true)
    try {
      const issued = await issuePairing()
      setNow(Date.now())
      setPairing(issued)
    } catch (err) {
      toast.error(errorText(err, "登録コードを出せませんでした"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Smartphone className="size-4" aria-hidden />
            スマホから見る（読み取り専用）
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <Switch id="lan-enabled" checked={data.enabled} disabled={busy} onCheckedChange={(v) => void toggle(v)} />
            <Label htmlFor="lan-enabled">{data.enabled ? "オン" : "オフ（既定）"}</Label>
          </div>
          <p data-testid="lan-status">
            {!data.enabled && "オフです。スマホからは見られません。"}
            {data.enabled && data.status.state === "listening" && (
              <>
                待ち受け中：
                {data.status.urls.map((u) => (
                  <code key={u} className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                    {u}
                  </code>
                ))}
              </>
            )}
            {data.enabled && data.status.state === "off" && "待ち受けを始めています…（数秒かかります）"}
            {data.enabled && data.status.state === "no-address" &&
              "この PC の家の LAN の IP アドレスが見つかりません。Wi-Fi か有線 LAN につないでいるか確かめてください。"}
          </p>
          {data.enabled && data.status.error && (
            <p className="text-[var(--status-critical-text)]" role="alert">
              {data.status.error}
            </p>
          )}
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            <li>スマホから見られるのは、ホーム・セッション一覧・利用上限・整理の4ページだけです。設定の変更などの書き込みは、PC からだけできます。</li>
            <li>初めてオンにしたとき、Windows のファイアウォールの確認が出ます。「プライベート ネットワーク」だけを許可してください。</li>
            <li>通信は暗号化されません（HTTP）。来客用・公共の Wi-Fi では使わず、使わないときはオフにしてください。</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <QrCode className="size-4" aria-hidden />
            端末の登録
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            スマホの IP アドレスを入れる必要はありません。「登録コードを出す」を押し、出てきた QR コードをスマホのカメラで読み取ると、その端末が登録されます。
            登録できたら、スマホで開いたページをブックマーク（ホーム画面に追加）して、次からはそこから開きます。
          </p>
          <Button onClick={() => void issue()} disabled={!listening || busy} data-testid="lan-issue">
            登録コードを出す
          </Button>
          {!listening && <p className="text-xs text-muted-foreground">オンにして、待ち受けが始まると押せます。</p>}
          {data.pairing.locked && !shown && (
            <p className="text-[var(--status-critical-text)]">まちがったコードが続いたため、登録を止めています。「登録コードを出す」を押すと、また登録できます。</p>
          )}
          {shown && (
            <div className="flex flex-col gap-4 rounded-lg border p-3 sm:flex-row sm:items-center" data-testid="lan-pairing">
              {/* QR の SVG は、サーバーが qrcode で作った図形だけ(外部の読み込み・スクリプトは無い) */}
              <div
                className="size-48 shrink-0 self-center rounded bg-white p-1 [&>svg]:size-full"
                aria-label="登録用の QR コード"
                role="img"
                dangerouslySetInnerHTML={{ __html: shown.qrSvg }}
              />
              <div className="min-w-0 space-y-1.5">
                <p>
                  登録コード：<span className="font-mono text-lg font-semibold tracking-widest">{shown.code}</span>
                </p>
                <p className="text-muted-foreground">
                  残り {Math.floor(remainingMs / 60000)}分{String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0")}秒・1回だけ使えます
                </p>
                <p className="text-xs text-muted-foreground">QR コードを読めないときは、スマホのブラウザでこの URL を開きます：</p>
                {shown.urls.map((u) => (
                  <code key={u} className="block break-all rounded bg-muted px-1.5 py-0.5 text-xs">
                    {u}
                  </code>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">登録した端末（{data.devices.length}台・10台まで）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.devices.length === 0 && <p className="text-muted-foreground">登録した端末はありません。</p>}
          {data.devices.map((d) => (
            <DeviceRow key={d.id} device={d} onRename={rename} onRevoke={() => setRevoking(d)} />
          ))}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            登録の期限は90日です。なくした・手放した端末は、すぐに取り消してください（次の表示から見られなくなります）。
          </p>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="この端末を取り消しますか"
        description={`「${revoking?.name ?? ""}」からは、次の表示から見られなくなります。もう一度見るには、登録し直します。`}
        confirmLabel="取り消す"
        onConfirm={() => {
          const target = revoking
          setRevoking(null)
          if (target) void revoke(target.id).catch((err) => toast.error(errorText(err, "取り消せませんでした")))
        }}
      />
    </div>
  )
}

function DeviceRow({
  device,
  onRename,
  onRevoke,
}: {
  device: PublicLanDevice
  onRename: (id: string, name: string) => Promise<void>
  onRevoke: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(device.name)

  async function save() {
    try {
      await onRename(device.id, name)
      setEditing(false)
    } catch (err) {
      toast.error(errorText(err, "名前を変えられませんでした"))
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2.5 sm:flex-row sm:items-center sm:justify-between" data-testid="lan-device">
      <div className="min-w-0 space-y-0.5">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="h-8 w-48" aria-label="端末の名前" />
            <Button size="sm" onClick={() => void save()} disabled={!name.trim()}>
              保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              やめる
            </Button>
          </div>
        ) : (
          <p className="font-medium">{device.name}</p>
        )}
        <p className="text-xs text-muted-foreground">
          登録 {formatDateTime(device.createdAt)}・最後に見た {formatDateTime(device.lastSeenAt)}・期限 {formatDateTime(device.expiresAt)}
        </p>
      </div>
      {!editing && (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            名前を変える
          </Button>
          <Button size="sm" variant="destructive" onClick={onRevoke}>
            取り消す
          </Button>
        </div>
      )}
    </div>
  )
}
