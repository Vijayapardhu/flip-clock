'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The renderer's entire surface: settings, window control, update status and
 * one UI signal. No Node, no raw ipcRenderer.
 */
contextBridge.exposeInMainWorld('flip', {
  // --- settings -----------------------------------------------------------
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getPresets: () => ipcRenderer.invoke('settings:presets'),
  patchSettings: (partial) => ipcRenderer.send('settings:patch', partial),
  resetSettings: () => ipcRenderer.send('settings:reset'),
  getSettingsFilePath: () => ipcRenderer.invoke('settings:file'),
  openSettingsFile: () => ipcRenderer.send('settings:open-file'),
  onSettingsChanged: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },

  // --- window -------------------------------------------------------------
  getBounds: () => ipcRenderer.invoke('window:bounds'),
  moveTo: (x, y) => ipcRenderer.send('window:move', { x, y }),
  toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen'),
  quit: () => ipcRenderer.send('app:quit'),
  onFullscreenChange: (callback) => {
    const handler = (_event, value) => callback(Boolean(value));
    ipcRenderer.on('window:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', handler);
  },

  // --- settings panel signal (lets Esc/Q close instead of quitting) -------
  setPanelOpen: (open) => ipcRenderer.send('ui:set-panel-open', Boolean(open)),
  onCloseSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ui:close-settings', handler);
    return () => ipcRenderer.removeListener('ui:close-settings', handler);
  },
  onToggleSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ui:toggle-settings', handler);
    return () => ipcRenderer.removeListener('ui:toggle-settings', handler);
  },

  // --- updates ------------------------------------------------------------
  onUpdateStatus: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
  installUpdate: () => ipcRenderer.send('update:install'),
});
