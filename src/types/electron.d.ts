export {}

/** 優先ポートが使えず、別のポートで起動した（この起動の間は、画面の設定が通常と別扱いになる） */
export interface StartupNotice {
  kind: "port-fallback"
  /** 実際に使っているポート */
  port: number
  /** 使えなかった優先ポート */
  preferredPort: number
}

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
      /**
       * 起動の通知。優先ポートが使えず別のポートで起動したときだけ入っている。メインプロセスが1回だけ渡す
       * （2回目以降・再読み込みのあとは null）。electron/startupNotice.js の portFallbackNotice が作る形
       */
      getStartupNotice: () => Promise<StartupNotice | null>
      /** 通知をクリックされたとき、対象のセッションIDで呼ばれる。登録の解除関数を返す */
      onNotificationOpen: (callback: (sessionId: string | null) => void) => () => void
    }
  }
}
