'use strict';

/**
 * Visual check for the desktop shell ribbon + the reference-matched mobile
 * cards. Uses the real preload and the same window options as desktop/main.js.
 */

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, ipcMain } = require('electron');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'website');
const OUT = ROOT;
const errors = [];

let win = null;

function registerIpc() {
  ipcMain.on('shell:minimize', () => {});
  ipcMain.on('shell:close', () => {});
  ipcMain.on('shell:toggle-maximize', () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('shell:is-maximized', () => Boolean(win?.isMaximized()));
}

function createWindow() {
  win = new BrowserWindow({
    width: 427,
    height: 952,
    useContentSize: true,
    minWidth: 380,
    minHeight: 560,
    show: true,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      partition: `shell-smoke-${Date.now()}`,
      preload: path.join(ROOT, 'desktop', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (event, level, message) => {
    if (level >= 2) errors.push(message);
  });
  win.on('maximize', () => win.webContents.send('shell:maximized', true));
  win.on('unmaximize', () => win.webContents.send('shell:maximized', false));
  return win.loadFile(path.join(SITE, 'index.html'), { query: { shell: '1' } });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name), image.toPNG());
}

async function inspect(label) {
  const info = await win.webContents.executeJavaScript(`(() => {
    const rect = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
    };
    const cards = [...document.querySelectorAll('#stage .flip-card')].map((card) => {
      const b = card.getBoundingClientRect();
      const s = getComputedStyle(card);
      return { rect: rect(card), font: s.fontSize, radius: getComputedStyle(card.closest('.holder')).borderRadius, text: card.querySelector('.top .glyph')?.textContent };
    });
    const ribbon = document.querySelector('.shell-ribbon');
    const dateLine = document.querySelector('#dateLine');
    return {
      viewport: [innerWidth, innerHeight],
      shellClass: document.documentElement.classList.contains('shell'),
      desktopApi: window.desktop ? Object.keys(window.desktop) : null,
      ribbon: ribbon ? { display: getComputedStyle(ribbon).display, ...{ rect: rect(ribbon) } } : null,
      dateTop: dateLine ? getComputedStyle(dateLine).top : null,
      cards,
      stage: rect(document.querySelector('#stage')),
      gap: getComputedStyle(document.querySelector('#stage')).gap,
      secondsShown: document.querySelector('#stage').classList.contains('show-seconds'),
      localStorageSeconds: localStorage.getItem('show_seconds'),
      maximizeIcon: getComputedStyle(document.querySelector('.ico-restore')).display,
      maximizedClass: document.documentElement.classList.contains('is-maximized'),
    };
  })()`);
  console.log(label + ' ' + JSON.stringify(info));
  return info;
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerIpc();
  try {
    await createWindow();
    await wait(2200);
    await inspect('MOBILE');
    await shot('smoke-shell-mobile.png');

    // Maximize through the page's own button (exercises preload + IPC + icon swap).
    await win.webContents.executeJavaScript(`document.querySelector('#winMaximize').click()`);
    await wait(900);
    await inspect('MAXIMIZED');
    await win.unmaximize();
    await wait(600);

    win.setContentSize(1180, 760);
    await wait(1200);
    await inspect('DESKTOP');
    await shot('smoke-shell-desktop.png');

    win.setContentSize(380, 560);
    await wait(1200);
    await inspect('MIN');
    await shot('smoke-shell-min.png');

    console.log('CONSOLE_ERRORS ' + JSON.stringify(errors));
  } catch (error) {
    console.error('FAILED', error);
  }
  app.quit();
});
