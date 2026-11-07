const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quinnDesktop", {
openDashboard: () => ipcRenderer.send("quinn:open-dashboard"),
minimizeCompanion: () => ipcRenderer.send("quinn:minimize-companion"),
closeCompanion: () => ipcRenderer.send("quinn:close-companion"),
  synthesizeVoice: (text, profileId) => ipcRenderer.invoke("quinn:synthesize", text, profileId),
});
