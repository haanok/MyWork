const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('customerBoard', {
  chooseCustomerRoot: () => ipcRenderer.invoke('vault:choose-root'),
  getCustomerRoot: () => ipcRenderer.invoke('vault:get-root'),
  listMarkdown: () => ipcRenderer.invoke('vault:list-markdown'),
  writeMarkdown: (relativePath, content) => ipcRenderer.invoke('vault:write-markdown', relativePath, content),
  trashMarkdown: (relativePath) => ipcRenderer.invoke('vault:trash-markdown', relativePath),
  onVaultChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('vault:changed', listener);
    return () => ipcRenderer.removeListener('vault:changed', listener);
  },
});
