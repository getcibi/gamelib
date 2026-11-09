const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gamelib', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  onProgress: (fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on('library:progress', h);
    return () => ipcRenderer.off('library:progress', h);
  },
  launch: (appId, installed) => ipcRenderer.invoke('game:launch', appId, installed),
  openApiKeyPage: () => ipcRenderer.invoke('open:apikey'),
});
