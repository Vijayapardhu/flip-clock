'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The website's only desktop surface: three window verbs and the maximize
 * state. Nothing else from Node or Electron is exposed.
 */
contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('shell:minimize'),
  toggleMaximize: () => ipcRenderer.send('shell:toggle-maximize'),
  close: () => ipcRenderer.send('shell:close'),
  isMaximized: () => ipcRenderer.invoke('shell:is-maximized'),
  onMaximized: (callback) => {
    const handler = (_event, value) => callback(Boolean(value));
    ipcRenderer.on('shell:maximized', handler);
    return () => ipcRenderer.removeListener('shell:maximized', handler);
  },
});
