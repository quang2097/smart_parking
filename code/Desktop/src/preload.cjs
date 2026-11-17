const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopTraffic', {
  request: (base, path, body) => ipcRenderer.invoke('traffic:request', base, path, body),
  clearSession: () => ipcRenderer.invoke('traffic:clear-session'),
  stopCameraMedia: () => ipcRenderer.invoke('traffic:stop-camera'),
});
