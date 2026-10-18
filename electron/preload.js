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
  // 通知をクリックされたとき、対象のセッションIDで呼ばれる。登録の解除関数を返す
  onNotificationOpen: (callback) => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on("desktop-notify:open", listener)
    return () => ipcRenderer.removeListener("desktop-notify:open", listener)
  },
})
