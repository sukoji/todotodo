const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('todoDesktop', {
  api: (endpoint, method, body) => ipcRenderer.invoke('todo:api', endpoint, method, body),
  state: () => ipcRenderer.invoke('todo:state'),
  setting: (key, value) => ipcRenderer.invoke('todo:setting', key, value),
  export: () => ipcRenderer.invoke('todo:export'),
  aiStatus: () => ipcRenderer.invoke('todo:ai-status'),
  aiKey: (provider, key) => ipcRenderer.invoke('todo:ai-key', provider, key),
  aiBrief: (provider, scope) => ipcRenderer.invoke('todo:ai-brief', provider, scope),
  claudeBundle: () => ipcRenderer.invoke('todo:claude-bundle'),
  compact: value => ipcRenderer.invoke('todo:compact', value),
  fold: () => ipcRenderer.invoke('todo:fold'),
  onCompactChanged: callback => ipcRenderer.on('todo:compact', (_event, value) => callback(value))
});
