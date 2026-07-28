const { contextBridge, ipcRenderer } = require("electron")

/**
 * <input type="file">のクリックによるネイティブダイアログ表示は、
 * 環境によって開かない事例が報告されたため（項目6）、
 * メインプロセスのdialog.showOpenDialogを直接呼び出す経路をIPCで用意する。
 */
contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  pickImportFile: () => ipcRenderer.invoke("dialog:pick-import-file"),
})
