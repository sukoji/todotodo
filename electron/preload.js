const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('todoDesktop', {
  api: (endpoint, method, body) => ipcRenderer.invoke('todo:api', endpoint, method, body),
  state: () => ipcRenderer.invoke('todo:state'),
  setting: (key, value) => ipcRenderer.invoke('todo:setting', key, value),
  export: () => ipcRenderer.invoke('todo:export'),
  importBackup: () => ipcRenderer.invoke('todo:import'),
  backupFolder: () => ipcRenderer.invoke('todo:backup-folder'),
  backupNow: () => ipcRenderer.invoke('todo:backup-now'),
  onBackupChanged: callback => ipcRenderer.on('todo:backup-status', (_event, status) => callback(status)),
  aiStatus: () => ipcRenderer.invoke('todo:ai-status'),
  aiKey: (provider, key) => ipcRenderer.invoke('todo:ai-key', provider, key),
  aiBrief: (provider, scope) => ipcRenderer.invoke('todo:ai-brief', provider, scope),
  claudeBundle: () => ipcRenderer.invoke('todo:claude-bundle'),
  compact: value => ipcRenderer.invoke('todo:compact', value),
  fold: () => ipcRenderer.invoke('todo:fold'),
  windowControl: action => ipcRenderer.invoke('todo:window-control', action),
  onCloseRequested: callback => ipcRenderer.on('todo:close-request', () => callback()),
  onCompactChanged: callback => ipcRenderer.on('todo:compact', (_event, value) => callback(value))
});
