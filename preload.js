const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openDirectory : ()          => ipcRenderer.invoke('dir:open'),
  loadDirectory : (dir)       => ipcRenderer.invoke('dir:load', dir),
  openFile      : (p)         => ipcRenderer.invoke('file:read', p),
  resolvePaths  : (base, rel) => ipcRenderer.invoke('path:resolve', base, rel),
  save          : (o)         => ipcRenderer.invoke('file:save', o),
  exportMany    : (files)     => ipcRenderer.invoke('doc:exportMany', files),
  exportPDF     : (o)         => ipcRenderer.invoke('doc:exportPDF', o),
  openExternal  : (url)       => ipcRenderer.invoke('shell:open', url),
  watch         : (dir)       => ipcRenderer.invoke('dir:watch', dir),
  info          : ()          => ipcRenderer.invoke('app:info'),
  // Electron ≥32 quitó File.path; hay que usar webUtils
  dropPath      : (file)      => { try { return webUtils.getPathForFile(file); } catch { return null; } },
  onFileChanged : (cb)        => ipcRenderer.on('file:changed', (_e, p) => cb(p)),
  onMenu        : (cb)        => ipcRenderer.on('menu:action', (_e, a) => cb(a))
});