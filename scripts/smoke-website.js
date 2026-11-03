'use strict';

/**
 * Loads the Flip Clock website in a hidden window and reports console errors.
 * Serves website/ over plain HTTP first (service workers need http), then:
 *   node scripts/smoke-website.js
 * Writes smoke-website.png (full page) and prints console errors/warnings.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu } = require('electron');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'website');
const SHOT = path.join(ROOT, 'smoke-website.png');

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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const { server, port } = await serve();
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: true, // hidden windows never re-composite → stale screenshots
    backgroundColor: '#000000',
    webPreferences: { backgroundThrottling: false },
  });

  const issues = [];
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const text = `[${level}] ${message} (${sourceId}:${line})`;
    if (level >= 2) issues.push(text);
    else console.log(text);
  });
  win.webContents.on('render-process-gone', (event, details) => {
    issues.push('render-process-gone: ' + JSON.stringify(details));
    server.close();
    app.quit();
  });
  win.webContents.on('did-fail-load', (event, code, description) => {
    issues.push(`did-fail-load ${code}: ${description}`);
  });

  try {
    await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  } catch (err) {
    issues.push('load threw: ' + err.message);
  }

  const probe = () =>
    win.webContents.executeJavaScript(`(() => {
      const q = (s) => document.querySelector(s);
      const rect = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
      return JSON.stringify({
        dataTheme: document.documentElement.getAttribute('data-theme'),
        bg: getComputedStyle(document.body).backgroundColor,
        sheets: document.querySelectorAll('.mode-swipe-sheet').length,
        sheetIsVisible: (() => { const s = document.querySelector('.mode-swipe-sheet'); if (!s) return 'none'; const r = s.getBoundingClientRect(); return 'left=' + r.left + ',top=' + r.top + ',w=' + r.width + ',h=' + r.height + ',opacity=' + getComputedStyle(s).opacity; })(),
        hourText: q('#card-hours .top .glyph').textContent,
      });
    })()`);

  const probeChildren = () => {};

  await new Promise((r) => setTimeout(r, 2500));
  console.log('initial :', await probe());

  // 0) Settings panel (clock mode) — design + layout check
  await win.webContents.executeJavaScript(`document.getElementById('menuToggle').click()`);
  await new Promise((r) => setTimeout(r, 800));
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 250));
  const panelShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ROOT, 'smoke-panel.png'), panelShot.toPNG());
  const panelProbe = await win.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    const rect = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
    return JSON.stringify({
      open: !q('#controls').classList.contains('close'),
      panel: rect(q('#controls')),
      scrollH: q('.panel-scroll').scrollHeight,
      scrollClient: q('.panel-scroll').clientHeight,
      sections: [...document.querySelectorAll('.section-title')].map((el) => el.textContent.trim()),
      rows: [...document.querySelectorAll('.pref-row')].map((el) => el.textContent.trim().replace(/\\s+/g, ' ')),
      secondsChecked: q('#secondsToggle').checked,
      secondsDisabled: q('#secondsToggle').disabled,
    });
  })()`);
  console.log('panel   :', panelProbe);
  await win.webContents.executeJavaScript(`document.getElementById('panelClose').click()`);
  await new Promise((r) => setTimeout(r, 500));

  // 0a) Timer mode + Pomodoro chip
  await win.webContents.executeJavaScript(`document.getElementById('timerBtn').click()`);
  await new Promise((r) => setTimeout(r, 500));
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 250));
  const timerShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ROOT, 'smoke-timer.png'), timerShot.toPNG());
  console.log('timer   :', await probe());

  // 0b) Focus 25m chip
  await win.webContents.executeJavaScript(`document.getElementById('pomoFocusBtn').click()`);
  await new Promise((r) => setTimeout(r, 600));

  // 0c) Custom theme builder
  const customSet = await win.webContents.executeJavaScript(`(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('customBg', '#120a2a'); set('customHolder', '#1d1140'); set('customText', '#ffd9a0');
    document.querySelector('.theme-swatch--custom').click();
    return document.documentElement.style.getPropertyValue('--background');
  })()`);
  console.log('custom  :', customSet);
  await new Promise((r) => setTimeout(r, 400));
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 250));
  const customShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ROOT, 'smoke-custom.png'), customShot.toPNG());

  // Back to the clock for the light/dark test
  await win.webContents.executeJavaScript(`document.getElementById('timerBtn').click()`); // back to clock
  await new Promise((r) => setTimeout(r, 400));

  // 1) Toggle dark -> light
  await win.webContents.executeJavaScript(`document.getElementById('modeToggle').click()`);
  await new Promise((r) => setTimeout(r, 1200)); // let the 550ms swipe finish
  console.log('after toggle ->', await probe());
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 250));
  const lightShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ROOT, 'smoke-light.png'), lightShot.toPNG());

  // 1b) Direct calls, with the error surfaced
  const direct = await win.webContents.executeJavaScript(`(() => {
    const out = [];
    try { FlipThemes.setMode('light'); out.push('setMode -> ' + document.documentElement.getAttribute('data-theme')); } catch (e) { out.push('setMode ERR: ' + (e && e.message)); }
    try { FlipThemes.setMode('dark'); out.push('setMode back -> ' + document.documentElement.getAttribute('data-theme')); } catch (e) { out.push('setMode back ERR: ' + (e && e.message)); }
    try { const r = FlipThemes.swipeToMode('light'); out.push('swipeToMode -> ' + document.documentElement.getAttribute('data-theme')); } catch (e) { out.push('swipe ERR: ' + (e && e.message) + ' :: ' + (e && e.stack && e.stack.split('\\n')[1])); }
    return out.join(' | ');
  })()`);
  console.log('direct   :', direct);
  await new Promise((r) => setTimeout(r, 1200));
  console.log('after swipe ->', await probe());

  // 2) Toggle back light -> dark
  await win.webContents.executeJavaScript(`document.getElementById('modeToggle').click()`);
  await new Promise((r) => setTimeout(r, 1200));
  console.log('back to dark ->', await probe());

  // 3) Pick the Amber (theme4) swatch
  await win.webContents.executeJavaScript(`document.querySelector('.theme-swatch[data-theme-name="theme4"]').click()`);
  await new Promise((r) => setTimeout(r, 600));
  console.log('theme4   ->', await probe());
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 250));
  const themeShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ROOT, 'smoke-theme4.png'), themeShot.toPNG());

  try {
    win.webContents.invalidate();
    await new Promise((r) => setTimeout(r, 250));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(SHOT, image.toPNG());
  } catch (err) {
    issues.push('capture failed: ' + err.message);
  }

  console.log('=== console errors/warnings ===');
  console.log(issues.length ? issues.join('\n') : 'NONE');

  server.close();
  app.quit();
});
