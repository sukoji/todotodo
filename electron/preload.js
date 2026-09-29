const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('todoDesktop', {
  api: (endpoint, method, body) => ipcRenderer.invoke('todo:api', endpoint, method, body),
  state: () => ipcRenderer.invoke('todo:state'),
  setting: (key, value) => ipcRenderer.invoke('todo:setting', key, value),
  export: () => ipcRenderer.invoke('todo:export')
});
