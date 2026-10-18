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
      /** Claude Desktopのセッションを claude:// のリンクで開く。許可した形式のURL以外は開かず ok:false を返す */
      openExternal: (url: string) => Promise<{ ok: boolean }>
      /** 通知をクリックされたとき、対象のセッションIDで呼ばれる。登録の解除関数を返す */
      onNotificationOpen: (callback: (sessionId: string | null) => void) => () => void
    }
  }
}
