'use strict';

/**
 * FlipClock — renderer.
 *
 * Owns four things:
 *   1. Building the six-digit flip-card DOM.
 *   2. The mechanical flip animation (a real 3D fold, four faces per digit).
 *   3. Proportional auto-scaling to any window size / monitor resolution.
 *   4. Applying settings.json live — colours, type, motion, time format.
 */

(() => {
  // -------------------------------------------------------------------------
  // Geometry — ratios of card height (h). The clock is fully resolution
  // independent and keeps its exact aspect ratio at any size.
  // -------------------------------------------------------------------------
  const G = {
    digit: 0.66,
    panelGap: 0.26,
    radius: 0.1,
    font: 0.92,
    margin: 0.05,
  };

  // Fixed alpha for the three colours that carry transparency in settings.
  const ALPHA = { glyphShadow: 0.55, seamDark: 0.95, seamLight: 0.06 };

  const root = document.documentElement;
  const api = window.flip || {};

  const clockEl = document.getElementById('clock');
  const meridiemEl = document.getElementById('meridiem');
  const panelEl = document.getElementById('settingsPanel');

  let settings = null;
  let timer = 0;

  // -------------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------------
  const digitMarkup = (side) => `
    <div class="flip-digit ${side}">
      <div class="face top static"><span>0</span></div>
      <div class="face bottom static"><span>0</span></div>
      <div class="face top flap"><span>0</span></div>
      <div class="face bottom flap"><span>0</span></div>
    </div>`;

  clockEl.innerHTML = Array.from(
    { length: 3 },
    (_, index) =>
      `<div class="panel" data-unit="${['h', 'm', 's'][index]}">${digitMarkup('l')}${digitMarkup('r')}</div>`,
  ).join('');

  const panels = Array.from(clockEl.querySelectorAll('.panel'));

  // -------------------------------------------------------------------------
  // One flipping digit
  // -------------------------------------------------------------------------
  class FlipDigit {
    constructor(el) {
      this.el = el;
      this.staticTop = el.querySelector('.face.top.static span');
      this.staticBottom = el.querySelector('.face.bottom.static span');
      this.flapTop = el.querySelector('.face.top.flap span');
      this.flapBottom = el.querySelector('.face.bottom.flap span');
      this.value = '0';
      this.timer = 0;
      this._paintAll('0');
    }

    _paintAll(value) {
      this.staticTop.textContent = value;
      this.staticBottom.textContent = value;
      this.flapTop.textContent = value;
      this.flapBottom.textContent = value;
    }

    /** Snap any in-flight animation to its end state immediately. */
    _settle() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = 0;
      }
      this.el.classList.remove('animating');
      this._paintAll(this.value);
    }

    /** @param {string} next single digit character */
    set(next, animate = true) {
      next = String(next);
      if (next === this.value) return;

      this._settle();

      const previous = this.value;
      this.value = next;

      if (!animate) {
        this._paintAll(next);
        return;
      }

      // Behind the falling flap: the new upper half, already in place.
      this.staticTop.textContent = next;
      // Still visible under the flap until it lands: the old lower half.
      this.staticBottom.textContent = previous;
      // The two travelling halves: old top folding away, new bottom arriving.
      this.flapTop.textContent = previous;
      this.flapBottom.textContent = next;

      // Reflow between removing and adding the class so animations restart
      // reliably on every transition.
      this.el.classList.remove('animating');
      void this.el.offsetWidth;
      this.el.classList.add('animating');

      const total = (Number(getComputedStyle(root).getPropertyValue('--flip-ms')) || 250) * 2 + 40;
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.el.classList.remove('animating');
        this._paintAll(this.value);
      }, total);
    }
  }

  const digits = Array.from(clockEl.querySelectorAll('.flip-digit'), (el) => new FlipDigit(el));

  // -------------------------------------------------------------------------
  // Colour helpers
  // -------------------------------------------------------------------------
  function toHex(value) {
    const input = String(value == null ? '' : value).trim();
    let match = /^#([0-9a-f]{3})$/i.exec(input);
    if (match) {
      const [r, g, b] = match[1].split('');
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    match = /^#([0-9a-f]{6})$/i.exec(input);
    if (match) return `#${match[1].toLowerCase()}`;
    match = /^#([0-9a-f]{8})$/i.exec(input);
    if (match) return `#${match[1].slice(0, 6).toLowerCase()}`;
    match = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/i.exec(input);
    if (match) {
      const channel = (n) =>
        Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0');
      return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;
    }
    return '#000000';
  }

  function getAlpha(value) {
    const match = /rgba?\([^)]*,\s*([\d.]+)\s*\)/i.exec(String(value));
    if (match) return Number(match[1]);
    const hex = String(value).trim();
    if (/^#[0-9a-f]{8}$/i.test(hex)) return parseInt(hex.slice(7, 9), 16) / 255;
    return 1;
  }

  function withAlpha(color, alpha) {
    if (alpha >= 0.999) return toHex(color);
    const hex = toHex(color);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const setVar = (name, value) => root.style.setProperty(name, value);

  // -------------------------------------------------------------------------
  // Settings application
  // -------------------------------------------------------------------------
  function applyAppearance(a) {
    setVar('--bg', a.background);
    setVar('--card-top-a', a.cardTopStart);
    setVar('--card-top-b', a.cardTopEnd);
    setVar('--card-bot-a', a.cardBottomStart);
    setVar('--card-bot-b', a.cardBottomEnd);
    setVar('--glyph', a.glyph);
    setVar('--glyph-shadow', withAlpha(a.glyphShadow, ALPHA.glyphShadow));
    setVar('--seam-dark', withAlpha(a.seamDark, ALPHA.seamDark));
    setVar('--seam-light', withAlpha(a.seamLight, ALPHA.seamLight));
    setVar('--font-stack', a.fontStack || G_FONT_STACK);
    setVar('--glyph-weight', String(a.fontWeight));
    setVar('--glyph-spacing', `${a.letterSpacing}em`);
  }

  const G_FONT_STACK =
    '"Inter", "SF Pro Display", "Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif';

  function layout() {
    const a = settings.appearance;
    const m = settings.motion;
    const count = settings.time.showSeconds ? 3 : 2;

    // Total width in units of h: n panels of 2 digits, plus (n-1) gaps.
    const clockW = count * 2 * a.digitWidth + (count - 1) * a.panelGap;
    const availableW = Math.max(window.innerWidth, 1) * (1 - a.margin * 2);
    const availableH = Math.max(window.innerHeight, 1) * (1 - a.margin * 2);
    const h = Math.max(24, Math.min(availableW / clockW, availableH));

    setVar('--h', `${h}px`);
    setVar('--digit-w', `${h * a.digitWidth}px`);
    setVar('--gap', `${h * a.panelGap}px`);
    setVar('--radius', `${h * a.radius}px`);
    setVar('--font', `${h * a.fontScale}px`);
    setVar('--flip-ms', `${m.flipMs}ms`);
    setVar('--flip-ease', m.easingCss || 'cubic-bezier(0.42, 0, 0.58, 1)');

    root.dataset.reducedMotion = m.reducedMotion || 'auto';
    panels[2].classList.toggle('is-hidden', !settings.time.showSeconds);
  }

  const pad2 = (n) => (n < 10 ? `0${n}` : String(n));

  function renderTime(date, animate = false) {
    const t = settings.time;
    let hours = date.getHours();
    let meridiem = '';

    if (t.format === '12') {
      meridiem = hours >= 12 ? 'PM' : 'AM';
      hours %= 12;
      if (hours === 0) hours = 12;
    }

    const text =
      pad2(hours) +
      pad2(date.getMinutes()) +
      (t.showSeconds ? pad2(date.getSeconds()) : '');

    const visible = t.showSeconds ? 6 : 4;
    for (let i = 0; i < 6; i += 1) {
      if (i >= visible) continue; // hidden panel — leave it alone
      digits[i].set(text.charAt(i), animate);
    }

    const showMeridiem = t.format === '12' && t.showAmPm;
    meridiemEl.hidden = !showMeridiem;
    if (showMeridiem) meridiemEl.textContent = meridiem;
  }

  function applySettings(next, { animate = false } = {}) {
    settings = next;
    applyAppearance(next.appearance);
    layout();
    renderTime(new Date(), animate);
    syncForm(next);
  }

  // Self-correcting tick aligned to the wall-clock second boundary. It re-reads
  // the clock every time, so it recovers by itself after sleep or a timezone
  // change.
  function tick() {
    renderTime(new Date(), true);
    window.clearTimeout(timer);
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 8);
  }

  function startTicking() {
    window.clearTimeout(timer);
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 8);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && settings) renderTime(new Date(), false);
  });
  window.addEventListener('focus', () => {
    if (settings) renderTime(new Date(), false);
  });

  window.addEventListener('resize', () => settings && layout(), { passive: true });

  // -------------------------------------------------------------------------
  // Settings form
  // -------------------------------------------------------------------------
  const pathInputs = Array.from(panelEl.querySelectorAll('[data-path]'));
  const segments = Array.from(panelEl.querySelectorAll('[data-segment]'));
  const presetButtons = Array.from(panelEl.querySelectorAll('[data-preset]'));
  let presets = {};

  const readPath = (source, path) =>
    path.split('.').reduce((node, key) => (node === undefined ? undefined : node[key]), source);

  function writePath(target, path, value) {
    const keys = path.split('.');
    let node = target;
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (!node[keys[i]] || typeof node[keys[i]] !== 'object') node[keys[i]] = {};
      node = node[keys[i]];
    }
    node[keys[keys.length - 1]] = value;
    return target;
  }

  function syncForm(s) {
    for (const input of pathInputs) {
      const value = readPath(s, input.dataset.path);
      if (input.type === 'checkbox') {
        if (input.checked !== Boolean(value)) input.checked = Boolean(value);
      } else if (input.type === 'range') {
        if (Number(input.value) !== Number(value)) input.value = String(value);
      } else if (input.type === 'color') {
        const hex = toHex(value);
        if (input.value !== hex) input.value = hex;
      } else if (input.value !== String(value)) {
        input.value = String(value);
      }
    }

    for (const group of segments) {
      const value = String(readPath(s, group.dataset.segment));
      for (const button of group.querySelectorAll('button')) {
        button.classList.toggle('is-active', button.dataset.value === value);
      }
    }

    syncPresetHighlight(s);
  }

  function syncPresetHighlight(s) {
    for (const button of presetButtons) {
      const preset = presets[button.dataset.preset];
      if (!preset) continue;
      const matches = Object.entries(preset).every(
        ([key, value]) => String(readPath(s.appearance, key)) === String(value),
      );
      button.classList.toggle('is-active', matches);
    }
  }

  for (const input of pathInputs) {
    const handler = () => {
      let value;
      if (input.type === 'checkbox') value = input.checked;
      else if (input.type === 'range') value = Number(input.value);
      else if (input.type === 'color') {
        // Preserve the alpha the setting already carries — the picker can only
        // express RGB.
        const current = readPath(settings, input.dataset.path);
        value = withAlpha(input.value, getAlpha(current));
      } else value = input.value;

      const patch = {};
      writePath(patch, input.dataset.path, value);
      api.patchSettings?.(patch);
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  }

  for (const group of segments) {
    for (const button of group.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        const patch = {};
        writePath(patch, group.dataset.segment, button.dataset.value);
        api.patchSettings?.(patch);
      });
    }
  }

  for (const button of presetButtons) {
    button.addEventListener('click', () => {
      const preset = presets[button.dataset.preset];
      if (preset) api.patchSettings?.({ appearance: preset });
    });
  }

  function paintPresetSwatches() {
    for (const button of presetButtons) {
      const preset = presets[button.dataset.preset];
      const swatch = button.querySelector('i');
      if (preset && swatch) {
        swatch.style.background = `linear-gradient(180deg, ${preset.cardTopStart} 0%, ${preset.cardTopEnd} 50%, ${preset.cardBottomStart} 50%, ${preset.cardBottomEnd} 100%)`;
      }
    }
  }

  document.getElementById('settingsReset').addEventListener('click', () => api.resetSettings?.());
  document.getElementById('settingsOpenFile').addEventListener('click', () =>
    api.openSettingsFile?.(),
  );

  // -------------------------------------------------------------------------
  // Settings panel open / close
  // -------------------------------------------------------------------------
  let settingsOpen = false;

  function openSettings() {
    if (settingsOpen) return;
    settingsOpen = true;
    panelEl.hidden = false;
    panelEl.setAttribute('aria-hidden', 'false');
    root.classList.add('panel-open');
    requestAnimationFrame(() => panelEl.classList.add('is-open'));
    api.setPanelOpen?.(true);
  }

  function closeSettings() {
    if (!settingsOpen) return;
    settingsOpen = false;
    panelEl.classList.remove('is-open');
    root.classList.remove('panel-open');
    api.setPanelOpen?.(false);
    window.setTimeout(() => {
      if (settingsOpen) return;
      panelEl.hidden = true;
      panelEl.setAttribute('aria-hidden', 'true');
    }, 360);
  }

  document.getElementById('settingsClose').addEventListener('click', closeSettings);
  api.onToggleSettings?.(() => (settingsOpen ? closeSettings() : openSettings()));
  api.onCloseSettings?.(closeSettings);

  // -------------------------------------------------------------------------
  // Update toast
  // -------------------------------------------------------------------------
  const toastEl = document.getElementById('updateToast');
  const toastText = document.getElementById('updateToastText');
  const toastAction = document.getElementById('updateToastAction');
  let toastTimer = 0;

  function showToast(text, { action = false, persist = false } = {}) {
    toastText.textContent = text;
    toastAction.hidden = !action;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('is-visible'));
    window.clearTimeout(toastTimer);
    if (!persist) toastTimer = window.setTimeout(hideToast, action ? 12000 : 3200);
  }

  function hideToast() {
    toastEl.classList.remove('is-visible');
    window.setTimeout(() => {
      if (!toastEl.classList.contains('is-visible')) toastEl.hidden = true;
    }, 360);
  }

  toastAction.addEventListener('click', () => api.installUpdate?.());

  api.onUpdateStatus?.((status) => {
    if (!status) return;
    if (status.state === 'available') showToast(`Update ${status.version} found — downloading…`);
    else if (status.state === 'downloading') showToast(`Downloading update… ${status.percent}%`);
    else if (status.state === 'ready')
      showToast(`FlipClock ${status.version} is ready.`, { action: true, persist: true });
    else if (status.state === 'error') hideToast();
  });

  // -------------------------------------------------------------------------
  // Window interactions — drag to move, double-click to fullscreen.
  // -------------------------------------------------------------------------
  let fullscreen = false;

  api.onFullscreenChange?.((value) => {
    fullscreen = value;
    root.classList.toggle('fullscreen', value);
  });

  let drag = null;

  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || fullscreen || settingsOpen) return;
    if (typeof api.getBounds !== 'function') return;

    const session = {
      startX: event.screenX,
      startY: event.screenY,
      originX: null,
      originY: null,
      active: false,
    };
    drag = session;

    api.getBounds().then((bounds) => {
      if (!bounds || drag !== session) return;
      session.originX = bounds.x;
      session.originY = bounds.y;
    });
  });

  document.addEventListener('mousemove', (event) => {
    if (!drag || drag.originX === null) return;

    const dx = event.screenX - drag.startX;
    const dy = event.screenY - drag.startY;

    if (!drag.active && Math.abs(dx) + Math.abs(dy) > 3) drag.active = true;
    if (drag.active && typeof api.moveTo === 'function') {
      api.moveTo(drag.originX + dx, drag.originY + dy);
    }
  });

  const endDrag = () => {
    drag = null;
  };
  window.addEventListener('mouseup', endDrag);
  window.addEventListener('blur', endDrag);

  document.addEventListener('dblclick', () => {
    if (settingsOpen) return;
    api.toggleFullscreen?.();
  });

  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('dragstart', (event) => event.preventDefault());

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  Promise.resolve(api.getSettings?.())
    .then((value) => {
      if (value) applySettings(value);
      else applySettings({ appearance: { fontStack: G_FONT_STACK, fontWeight: 800, letterSpacing: -0.015, fontScale: G.font, digitWidth: G.digit, panelGap: G.panelGap, radius: G.radius, margin: G.margin, background: '#0a0a0a', cardTopStart: '#26262a', cardTopEnd: '#1c1c20', cardBottomStart: '#17171b', cardBottomEnd: '#111114', glyph: '#f6f6f8', glyphShadow: '#000000', seamDark: '#000000', seamLight: '#ffffff', fontFamily: 'inter' }, motion: { flipMs: 250, easingCss: 'cubic-bezier(0.42,0,0.58,1)', reducedMotion: 'auto' }, time: { format: '24', showSeconds: true, showAmPm: true }, behavior: {} });
    })
    .finally(() => startTicking());

  api.onSettingsChanged?.((next) => {
    if (next) applySettings(next, { animate: true });
  });

  Promise.resolve(api.getPresets?.()).then((value) => {
    if (!value) return;
    presets = value.presets || {};
    paintPresetSwatches();
    if (settings) syncPresetHighlight(settings);
  });
})();
