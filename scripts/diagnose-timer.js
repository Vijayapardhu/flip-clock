'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu } = require('electron');

const SITE = path.join(__dirname, '..', 'website');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      const file = path.normalize(path.join(SITE, urlPath));
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const { server, port } = await serve();
  const win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (event, level, message) => {
    if (level >= 2) console.log('CONSOLE[' + level + ']', message);
  });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  await new Promise((r) => setTimeout(r, 2000));

  const before = await win.webContents.executeJavaScript(`JSON.stringify({ mode: document.body.dataset.mode, stage: document.getElementById('stage').dataset.mode })`);
  console.log('BEFORE:', before);

  await win.webContents.executeJavaScript(`document.getElementById('timerBtn').click()`);
  await new Promise((r) => setTimeout(r, 500));

  const toggles = await win.webContents.executeJavaScript(`(async () => {
    const out = [];
    try {
      const a = document.getElementById('ambientToggle');
      a.click();
      await new Promise(r => setTimeout(r, 300));
      out.push('ambient on checked=' + a.checked);
      a.click();
      out.push('ambient off checked=' + a.checked);
    } catch (e) { out.push('ambient ERR: ' + e.message); }
    try {
      const w = document.getElementById('wakeToggle');
      w.click();
      await new Promise(r => setTimeout(r, 300));
      out.push('wake checked=' + w.checked + ' supported=' + ('wakeLock' in navigator));
      w.click();
      out.push('wake released checked=' + w.checked);
    } catch (e) { out.push('wake ERR: ' + e.message); }
    return out.join(' | ');
  })()`);
  console.log('TOGGLES:', toggles);

  const after = await win.webContents.executeJavaScript(`JSON.stringify({
    mode: document.body.dataset.mode,
    stageMode: document.getElementById('stage').dataset.mode,
    hourHolderDisplay: getComputedStyle(document.getElementById('hourHolder')).display,
    timerControlsHidden: document.getElementById('timerControls').classList.contains('hide'),
    transportVisible: !document.getElementById('timerControls').classList.contains('hide'),
    homeShown: !document.getElementById('homeBtn').classList.contains('hide'),
    sliderRow: !document.getElementById('timeSliderRow').classList.contains('hide'),
    panelOpen: !document.getElementById('controls').classList.contains('close'),
    minuteText: document.querySelector('#card-minutes .top .glyph').textContent
  })`);
  console.log('AFTER :', after);

  server.close();
  app.quit();
});
