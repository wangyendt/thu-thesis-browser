'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Only the packaged local shell receives this bridge, never the website.
contextBridge.exposeInMainWorld('browser', {
  command: (action, payload) => ipcRenderer.invoke('browser:command', action, payload),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('browser:state', listener);
    return () => ipcRenderer.removeListener('browser:state', listener);
  }
});
