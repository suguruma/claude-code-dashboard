export {}

declare global {
  interface Window {
    /** electron/preload.js がcontextBridge経由で公開する。exe以外(ブラウザ)では未定義 */
    electronAPI?: {
      isElectron: true
      pickImportFile: () => Promise<{ fileName: string; content: string } | { error: string } | null>
      /** 要対応のデスクトップ通知(ElectronのNotification)。メインプロセスが表示する */
      notify: (payload: { title: string; body: string; sessionId: string | null }) => Promise<{ ok: boolean }>
      /** OSが通知を表示できるか */
      notificationsSupported: () => Promise<boolean>
      /** 通知をクリックされたとき、対象のセッションIDで呼ばれる。登録の解除関数を返す */
      onNotificationOpen: (callback: (sessionId: string | null) => void) => () => void
    }
  }
}
