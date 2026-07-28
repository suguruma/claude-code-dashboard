export {}

declare global {
  interface Window {
    /** electron/preload.js がcontextBridge経由で公開する。exe以外(ブラウザ)では未定義 */
    electronAPI?: {
      isElectron: true
      pickImportFile: () => Promise<{ fileName: string; content: string } | { error: string } | null>
    }
  }
}
