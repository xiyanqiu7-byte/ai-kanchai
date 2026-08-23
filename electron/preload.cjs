const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('kanchai', {
  openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  saveFrame: (dataUrl, suggestedName) =>
    ipcRenderer.invoke('dialog:saveFrame', { dataUrl, suggestedName }),
  toMediaUrl: (filePath) => ipcRenderer.invoke('path:toMediaUrl', filePath),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return file?.path || ''
    }
  },
  analyzer: (method, path, body) =>
    ipcRenderer.invoke('analyzer:fetch', { method, path, body }),
})
