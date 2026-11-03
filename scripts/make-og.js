'use strict';

/**
 * Renders website/og.png (1200x630) by running the real clock renderer and
 * capturing it — so the social preview is always an actual screenshot of the
 * app, never a stale mock.
 *
 *   npm run og
 */

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'website', 'og.png');
const WIDTH = 1200;
const HEIGHT = 630;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));

  // Wait for the first flip cycle to settle, then capture a clean frame.
  await wait(1000 - (Date.now() % 1000));
  await wait(700);

  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, image.toPNG());
  process.stdout.write(`wrote ${path.relative(ROOT, OUTPUT)}  (${WIDTH}x${HEIGHT})\n`);

  app.exit(0);
});
