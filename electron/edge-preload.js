const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('todoEdge', {restore: () => ipcRenderer.invoke('edge:restore'), side: () => ipcRenderer.invoke('edge:side'), onSideChanged: listener => ipcRenderer.on('edge:side-changed', (_, side) => listener(side)), move: y => ipcRenderer.send('edge:move', y), drop: () => ipcRenderer.send('edge:drop')});
