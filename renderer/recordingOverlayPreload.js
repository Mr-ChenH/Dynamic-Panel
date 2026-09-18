const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recordingOverlayAPI', {
  stop: () => ipcRenderer.invoke('capture-overlay:stop'),
  discard: () => ipcRenderer.invoke('capture-overlay:discard'),
  onState: (callback) => ipcRenderer.on('capture-overlay:state', (_, state) => callback(state)),
});
