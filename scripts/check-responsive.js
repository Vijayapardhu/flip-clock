'use strict';

/**
 * Visual + behavioural check for the responsive work:
 *  - desktop panel (settings sheet)
 *  - window-resize easing (font-size transition)
 *  - portrait/mobile layout at a phone viewport (427 x 952, like the reference)
 *
 *   electron scripts/check-responsive.js
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu } = require('electron');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'website');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      const file = path.normalize(path.join(SITE, urlPath));
      if (!file.startsWith(SITE)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('not found: ' + urlPath);
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const { server, port } = await serve();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    backgroundColor: '#000000',
    webPreferences: { backgroundThrottling: false },
  });

  const issues = [];
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) issues.push(`[${level}] ${message} (${sourceId}:${line})`);
  });

  // Fresh defaults: no persisted settings from earlier test runs
  await win.webContents.session.clearStorageData();
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  await sleep(1800);

  const capture = async (name) => {
    win.webContents.invalidate();
    await sleep(220);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ROOT, name), image.toPNG());
  };

  const geom = () =>
    win.webContents.executeJavaScript(`(() => {
      const q = (s) => document.querySelector(s);
      const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
      const card = q('#card-hours');
      return JSON.stringify({
        vw: innerWidth, vh: innerHeight,
        portrait: matchMedia('(orientation: portrait)').matches,
        fontSize: getComputedStyle(card).fontSize,
        card: r(card),
        holders: [...document.querySelectorAll('.holder')].filter((h) => getComputedStyle(h).display !== 'none').map(r),
      });
    })()`);

  console.log('desktop :', await geom());
  await capture('smoke-desktop.png');

  // Resize easing: start small, grow the window, sample the animated font-size
  win.setSize(1024, 760);
  await sleep(700);
  const before = await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('#card-hours')).fontSize`);
  win.setSize(1600, 1000);
  const samples = [];
  for (let i = 0; i < 8; i += 1) {
    samples.push(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('#card-hours')).fontSize`));
    await sleep(80);
  }
  const after = await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('#card-hours')).fontSize`);
  console.log('resize  :', JSON.stringify({ before, samples, after }));

  // Phone viewport (matching the reference screenshot)
  win.setSize(427, 952);
  await sleep(1200);
  console.log('mobile  :', await geom());
  await capture('smoke-mobile.png');

  // Settings panel over the phone layout
  await win.webContents.executeJavaScript(`document.getElementById('menuToggle').click()`);
  await sleep(700);
  await capture('smoke-mobile-panel.png');

  console.log('=== console errors ===');
  console.log(issues.length ? issues.join('\n') : 'NONE');

  server.close();
  app.quit();
});
