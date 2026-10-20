const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cake', {
  fetchImage: (url, referer) => ipcRenderer.invoke('fetch-image', { url, referer }),
  loadState: () => ipcRenderer.invoke('load-state'),
  saveState: (state) => ipcRenderer.invoke('save-state', state),
  savePng: (dataUrl, name) => ipcRenderer.invoke('save-png', { dataUrl, name }),
  copyPng: (dataUrl) => ipcRenderer.invoke('copy-png', dataUrl),
  onGrab: (fn) => ipcRenderer.on('grab', (_e, d) => fn(d)),
});
