'use strict';

/**
 * FlipClock — main process.
 *
 * Owns: the frameless window, global shortcuts, persistent settings, the
 * auto-updater, and the thin IPC surface the renderer is allowed to touch.
 */

const path = require('node:path');
const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  powerSaveBlocker,
  screen,
  shell,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const SettingsStore = require('./settings-store');
const Config = require('./config');

const BACKGROUND = '#0a0a0a';
const DEFAULT_SIZE = { width: 1200, height: 320 };
const MIN_SIZE = { width: 420, height: 150 };
const UPDATE_CHECK_DELAY_MS = 6000;

/** @type {BrowserWindow | null} */
let win = null;
/** @type {SettingsStore | null} */
let store = null;
/** @type {number | null} */
let displayBlocker = null;
let settingsPanelOpen = false;
let updaterStarted = false;

const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const settings = store.get();

  win = new BrowserWindow({
    // No title bar, no borders, no min/max/close buttons, no menu.
    frame: false,
    backgroundColor: BACKGROUND,
    hasShadow: true,
    show: false,

    width: Math.min(DEFAULT_SIZE.width, workArea.width),
    height: DEFAULT_SIZE.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    useContentSize: true,

    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    title: 'FlipClock',

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A clock must never be throttled when it loses focus or is occluded.
      backgroundThrottling: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);

  // Never let the renderer navigate away or open new windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  attachShortcuts(win);

  win.on('enter-full-screen', () => send('window:fullscreen-changed', true));
  win.on('leave-full-screen', () => send('window:fullscreen-changed', false));

  win.once('ready-to-show', () => {
    win.center();
    if (settings.behavior.startFullscreen) win.setFullScreen(true);
    win.show();
    win.focus();
    scheduleUpdateCheck();
  });

  win.on('closed', () => {
    win = null;
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function toggleFullscreen() {
  if (!win) return;
  win.setFullScreen(!win.isFullScreen());
}

function quit() {
  app.quit();
}

// ---------------------------------------------------------------------------
// Shortcuts — handled in the main process so they work no matter what has
// focus, including when the settings panel is open.
// ---------------------------------------------------------------------------

function attachShortcuts(window) {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = (input.key || '').toLowerCase();

    if (input.key === 'F11' || key === 'f') {
      event.preventDefault();
      toggleFullscreen();
    } else if (key === 'escape' || key === 'q') {
      event.preventDefault();
      if (settingsPanelOpen) send('ui:close-settings');
      else quit();
    } else if (key === 's' || key === ',') {
      event.preventDefault();
      send('ui:toggle-settings');
    } else if (key === 't') {
      event.preventDefault();
      const next = !store.get().behavior.alwaysOnTop;
      store.patch({ behavior: { alwaysOnTop: next } });
    } else if (key === 'u') {
      event.preventDefault();
      installUpdate();
    }
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function applyBehavior(settings) {
  if (!win || win.isDestroyed()) return;

  win.setAlwaysOnTop(Boolean(settings.behavior.alwaysOnTop));

  const shouldKeepAwake = Boolean(settings.behavior.keepAwake);
  const isKeeping = displayBlocker !== null && powerSaveBlocker.isStarted(displayBlocker);

  if (shouldKeepAwake && !isKeeping) {
    displayBlocker = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!shouldKeepAwake && isKeeping) {
    powerSaveBlocker.stop(displayBlocker);
    displayBlocker = null;
  }
}

function registerIpc() {
  ipcMain.handle('settings:get', () => store.get());
  ipcMain.handle('settings:presets', () => ({
    labels: Config.PRESET_LABELS,
    presets: Config.PRESETS,
  }));
  ipcMain.on('settings:patch', (_event, partial) => store.patch(partial));
  ipcMain.on('settings:reset', () => store.reset());
  ipcMain.handle('settings:file', () => store.file);
  ipcMain.on('settings:open-file', () => {
    shell.showItemInFolder(store.file);
  });

  ipcMain.handle('window:bounds', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    return target ? target.getBounds() : null;
  });

  ipcMain.on('window:move', (event, position) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target || !position || target.isFullScreen()) return;
    const x = Math.round(position.x);
    const y = Math.round(position.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    target.setPosition(x, y, false);
  });

  ipcMain.on('window:toggle-fullscreen', () => toggleFullscreen());
  ipcMain.on('app:quit', () => quit());

  ipcMain.on('ui:set-panel-open', (_event, value) => {
    settingsPanelOpen = Boolean(value);
    if (win && !win.isDestroyed()) win.webContents.focus();
  });

  ipcMain.on('update:install', () => installUpdate());
}

// ---------------------------------------------------------------------------
// Auto-updater — GitHub Releases, silent, installs on quit.
// ---------------------------------------------------------------------------

function installUpdate() {
  if (!app.isPackaged || isPortable || !autoUpdater.downloadedUpdateHelper) return;
  autoUpdater.quitAndInstall(false, true);
}

function scheduleUpdateCheck() {
  if (updaterStarted) return;
  if (!app.isPackaged || isPortable) return;
  updaterStarted = true;

  const settings = store.get();
  if (!settings.behavior.autoUpdate) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.logger = {
    info: (msg) => console.log('[updater]', msg),
    warn: (msg) => console.warn('[updater]', msg),
    error: (msg) => console.error('[updater]', msg),
    debug: () => {},
  };

  autoUpdater.on('update-available', (info) =>
    send('update:status', { state: 'available', version: info.version }),
  );
  autoUpdater.on('update-not-available', () => send('update:status', { state: 'none' }));
  autoUpdater.on('download-progress', (progress) =>
    send('update:status', { state: 'downloading', percent: Math.round(progress.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    send('update:status', { state: 'ready', version: info.version }),
  );
  autoUpdater.on('error', (error) =>
    send('update:status', { state: 'error', message: String(error && error.message) }),
  );

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, UPDATE_CHECK_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    if (displayBlocker !== null && powerSaveBlocker.isStarted(displayBlocker)) {
      powerSaveBlocker.stop(displayBlocker);
    }
    displayBlocker = null;
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.flipclock.app');

    store = new SettingsStore();
    store.subscribe((settings) => {
      applyBehavior(settings);
      send('settings:changed', settings);
    });

    registerIpc();
    applyBehavior(store.get());
    createWindow();
  });
}
