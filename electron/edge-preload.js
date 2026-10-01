const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('todoEdge', {restore: () => ipcRenderer.invoke('edge:restore'), side: () => ipcRenderer.invoke('edge:side'), move: y => ipcRenderer.send('edge:move', y), drop: () => ipcRenderer.send('edge:drop')});
