const { contextBridge, ipcRenderer } = require("electron")

/**
 * <input type="file">のクリックによるネイティブダイアログ表示は、
 * 環境によって開かない事例が報告されたため（項目6）、
 * メインプロセスのdialog.showOpenDialogを直接呼び出す経路をIPCで用意する。
 */
contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  pickImportFile: () => ipcRenderer.invoke("dialog:pick-import-file"),
  // 要対応のデスクトップ通知(ElectronのNotification)。表示はメインプロセスが行う
  notify: (payload) => ipcRenderer.invoke("desktop-notify:show", payload),
  notificationsSupported: () => ipcRenderer.invoke("desktop-notify:supported"),
  // Claude Desktopのセッションを claude:// のリンクで開く。許可するURLの形式はメインプロセス側で検証する
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  // 起動の通知（優先ポートが使えず別のポートで起動したとき、画面上部の帯に出す内容）。メインプロセスが1回だけ渡し、無ければ null
  getStartupNotice: () => ipcRenderer.invoke("startup:notice"),
  // 通知をクリックされたとき、対象のセッションIDで呼ばれる。登録の解除関数を返す
  onNotificationOpen: (callback) => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on("desktop-notify:open", listener)
    return () => ipcRenderer.removeListener("desktop-notify:open", listener)
  },
})
