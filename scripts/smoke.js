'use strict';

/**
 * Dev-only smoke test. Boots the real renderer offscreen, waits for a full
 * second boundary (so a flip is captured mid-flight too), and writes a PNG.
 *
 *   npm run smoke
 */

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'smoke.png');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1600,
    height: 520,
    show: false,
    frame: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
    },
  });

  const errors = [];
  win.webContents.on('console-message', (...args) => {
    const details = args.find((a) => a && typeof a === 'object' && 'message' in a);
    const level = details ? details.level : args[1];
    const message = details ? details.message : args[2];
    if (String(level) === 'error' || level === 3) errors.push(String(message));
    process.stdout.write(`[renderer] ${message}\n`);
  });
  win.webContents.on('render-process-gone', (_e, d) =>
    errors.push(`renderer gone: ${JSON.stringify(d)}`),
  );

  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));

  // Align with a wall-clock second so a flip is captured mid-flight.
  await wait(1000 - (Date.now() % 1000));
  await wait(120);

  const report = await win.webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const clock = document.getElementById('clock');
    const r = clock.getBoundingClientRect();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const expected = pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    const shown = [...document.querySelectorAll('.flip-digit')]
      .map((d) => d.getAttribute('data-v') || d.querySelector('.top.static span').textContent).join('');
    const animating = document.querySelectorAll('.flip-digit.animating').length;
    return {
      panels: document.querySelectorAll('.panel').length,
      digits: document.querySelectorAll('.flip-digit').length,
      faces: document.querySelectorAll('.face').length,
      cardHeight: parseFloat(cs.getPropertyValue('--h')),
      fontSize: parseFloat(cs.getPropertyValue('--font')),
      clockW: Math.round(r.width),
      clockH: Math.round(r.height),
      expected,
      shown,
      animating,
      hasBridge: typeof window.flip === 'object',
      bridgeVerbs: window.flip ? Object.keys(window.flip).sort() : [],
    };
  })()`);

  const image = await win.webContents.capturePage();
  fs.writeFileSync(OUTPUT.replace('.png', '-flip.png'), image.toPNG());

  // Settled frame, once the animation has finished.
  await wait(400);
  const still = await win.webContents.capturePage();
  fs.writeFileSync(OUTPUT, still.toPNG());

  process.stdout.write('\n--- smoke report ---\n');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`console errors: ${errors.length ? errors.join(' | ') : 'none'}\n`);
  process.stdout.write(`wrote ${OUTPUT}\n`);

  app.exit(0);
});
