const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  clearHistory: () => ipcRenderer.send('clear-history'),
  onHistoryCleared: (callback) => ipcRenderer.on('history-cleared', (_event, ...args) => callback(...args)),
  showItemInFolder: (path) => ipcRenderer.send('show-item-in-folder', path),
  clearDownloads: () => ipcRenderer.send('clear-downloads'),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_event, ...args) => callback(...args)),
  canClose: () => ipcRenderer.invoke('can-close'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.send('update-settings', settings),
  selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),
  onSettingsUpdated: (callback) => ipcRenderer.on('settings-updated', (_event, ...args) => callback(...args)),
  savePassword: (creds) => ipcRenderer.send('save-password', creds),
  getPasswords: () => ipcRenderer.invoke('get-passwords')
});
