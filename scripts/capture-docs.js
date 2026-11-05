'use strict';

/**
 * Renders the README screenshots in docs/ from the real site, with a clean
 * profile and no OS window chrome.
 *
 *   node scripts/capture-docs.js   (through Electron: npx electron scripts/capture-docs.js)
 */

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, ipcMain } = require('electron');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'website');
const OUT = path.join(ROOT, 'docs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let shotIndex = 0;

async function settleClock(win) {
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const start = performance.now();
      let seen = false;
      const poll = setInterval(() => {
        const flipping = document.querySelector('.top-flip, .bottom-flip');
        if (flipping) seen = true;
        if (seen && !flipping) {
          clearInterval(poll);
          resolve(true);
          return;
        }
        if (performance.now() - start > 2500) {
          clearInterval(poll);
          resolve(false);
        }
      }, 25);
    })
  `);
  await wait(80);
}

async function capture({ name, width, height, shell = false, setup, crop }) {
  shotIndex += 1;
  const win = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: true,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      partition: `docs-shot-${Date.now()}-${shotIndex}`,
      preload: shell ? path.join(ROOT, 'desktop', 'preload.js') : undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  const query = shell ? { shell: '1' } : {};
  await win.loadFile(path.join(SITE, 'index.html'), { query });
  await wait(1500);
  if (setup) {
    await win.webContents.executeJavaScript(setup);
    await wait(800);
  }
  await settleClock(win);

  const image = await win.webContents.capturePage();
  const output = crop ? image.crop(crop) : image;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), output.toPNG());
  process.stdout.write(`wrote docs/${name}\n`);
  win.destroy();
}

app.on('window-all-closed', () => {
  // Keep the process alive between captures.
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  ipcMain.handle('shell:is-maximized', () => false);
  try {
    // Hero — the frameless desktop shell, default palette.
    await capture({ name: 'desktop-shell.png', width: 1600, height: 900, shell: true });

    // Phone portrait — warm light palette, three cards.
    await capture({
      name: 'mobile-amber.png',
      width: 427,
      height: 952,
      setup: `FlipThemes.setMode('light'); FlipThemes.setTheme('theme4');`,
    });

    // Redesigned settings sheet.
    await capture({
      name: 'settings-sheet.png',
      width: 1440,
      height: 900,
      shell: true,
      setup: `document.getElementById('menuToggle').click();`,
      crop: { x: 400, y: 100, width: 640, height: 800 },
    });

    // Theme variety — a calm dark palette and a bright light palette.
    await capture({
      name: 'iris-dark.png',
      width: 1440,
      height: 810,
      setup: `FlipThemes.setMode('dark'); FlipThemes.setTheme('theme2');`,
    });
    await capture({
      name: 'rose-light.png',
      width: 1440,
      height: 810,
      setup: `FlipThemes.setMode('light'); FlipThemes.setTheme('theme10');`,
    });
  } catch (error) {
    console.error(error);
  }
  app.quit();
});
