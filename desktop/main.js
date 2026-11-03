'use strict';

/**
 * Flip Clock — desktop shell.
 *
 * A frameless Electron window around the website in ../website. The page draws
 * its own theme-aware titlebar ribbon (?shell=1); this process only owns the
 * native window: size limits, window controls, external links and the app icon.
 */

const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');

const SITE = path.join(__dirname, '..', 'website');
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const BACKGROUND = '#000000';

const DEFAULT_SIZE = { width: 1180, height: 760 };
const MIN_SIZE = { width: 380, height: 560 };

/** @type {BrowserWindow | null} */
let win = null;

function sendMaximized(target) {
  if (target && !target.isDestroyed()) {
    target.webContents.send('shell:maximized', target.isMaximized());
  }
}

function createWindow() {
  win = new BrowserWindow({
    ...DEFAULT_SIZE,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    center: true,
    show: false,
    frame: false, // the page supplies its own titlebar ribbon
    backgroundColor: BACKGROUND,
    hasShadow: true,
    resizable: true,
    title: 'Flip Clock',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep the clock ticking while unfocused
    },
  });

  // No native menu bar, ever.
  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);

  // Links open in the user's browser, never inside the clock.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  win.on('maximize', () => sendMaximized(win));
  win.on('unmaximize', () => sendMaximized(win));
  win.webContents.on('did-finish-load', () => sendMaximized(win));
  win.on('closed', () => {
    win = null;
  });

  win.loadFile(path.join(SITE, 'index.html'), { query: { shell: '1' } });
}

function windowFor(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.on('shell:minimize', (event) => windowFor(event)?.minimize());
ipcMain.on('shell:close', (event) => windowFor(event)?.close());
ipcMain.on('shell:toggle-maximize', (event) => {
  const target = windowFor(event);
  if (!target) return;
  if (target.isMaximized()) target.unmaximize();
  else target.maximize();
});
ipcMain.handle('shell:is-maximized', (event) => Boolean(windowFor(event)?.isMaximized()));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.setAppUserModelId('com.flipclock.desktop');

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
