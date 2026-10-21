const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("splashAPI", {
  onProgress: (callback) => ipcRenderer.on("splash:progress", (_event, data) => callback(data)),
  // 目安の時間を超えたときの「まだ準備中です」と、利用者の選択（待つ・やめる）
  onSlow: (callback) => ipcRenderer.on("splash:slow", (_event, data) => callback(data)),
  choose: (choice) => ipcRenderer.send("splash:choice", choice === "quit" ? "quit" : "wait"),
})
