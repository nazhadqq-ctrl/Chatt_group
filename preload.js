const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  setServerUrl: (url) => ipcRenderer.invoke('set-server-url', url),
  retryConnection: () => ipcRenderer.invoke('retry-connection'),
  startLocalServer: () => ipcRenderer.invoke('start-local-server')
});
