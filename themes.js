'use strict';

// Desktop shell: the frameless Electron window loads the site with ?shell=1 —
// flag it before first paint so the custom titlebar ribbon lays out instantly.
if (new URLSearchParams(location.search).has('shell')) {
  document.documentElement.classList.add('shell');
}

/**
 * Flip Clock — themes
 *
 * Loaded in <head> (no defer) so the saved mode + palette are applied before
 * first paint — no flash of the wrong theme.
 *
 * State lives in localStorage:
 *   "data-theme"     -> "dark" | "light"      (absent = follow system)
 *   "current_theme"  -> "theme1".."theme11"   (absent = the default palette)
 *
 * Light/dark switch is a top-to-bottom reveal: a still of the page in the old
 * colors is wiped away with clip-path while the live page (theme vars) swaps
 * underneath with transitions disabled.
 */
const FlipThemes = (() => {
  // [background, holder, text]
  const PALETTES = {
    theme1: { dark: ['#0f140f', '#1a1f1a', '#c4ebc1'], light: ['#e8ffe8', '#d6f5d6', '#546654'] }, // Willow
    theme2: { dark: ['#131315', '#1b1c20', '#c5c8f8'], light: ['#eff2ff', '#e4e7fe', '#222843'] }, // Iris
    theme3: { dark: ['#1b1616', '#271e1e', '#ef6666'], light: ['#fff4f4', '#ffeded', '#ad3434'] }, // Ember
    theme4: { dark: ['#16120b', '#221e17', '#ffac45'], light: ['#fff7ec', '#ffedd6', '#8f5410'] }, // Amber
    theme5: { dark: ['#131519', '#1a1e23', '#cce1ff'], light: ['#f5f9ff', '#e4efff', '#2c3440'] }, // Glacier
    theme6: { dark: ['#0d0f11', '#14161a', '#ffd458'], light: ['#fffdf4', '#fff8e1', '#966b06'] }, // Citrine
    theme7: { dark: ['#1a171c', '#221d23', '#e3ceec'], light: ['#fcf5ff', '#f8e8ff', '#574260'] }, // Orchid
    theme8: { dark: ['#181b19', '#1e2320', '#beebd2'], light: ['#f5fffa', '#e6f8ee', '#496858'] }, // Mint
    theme9: { dark: ['#0a110f', '#101a17', '#6fc0c0'], light: ['#effaf6', '#ddf0ec', '#085858'] }, // Lagoon
    theme10: { dark: ['#160c0d', '#201315', '#e59eb9'], light: ['#fff4f3', '#fce4e8', '#763a53'] }, // Rose
    theme11: { dark: ['#150e03', '#1e1606', '#bfb28f'], light: ['#fff6e4', '#f7eace', '#594d2d'] }, // Sand
  };
  const PROPS = ['--background', '--holder', '--text'];
  const root = document.documentElement;

  const safeGet = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const safeSet = (key, value) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage may be unavailable (private mode) — the app still works */
    }
  };

  const getMode = () => (root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  const getToggle = () => document.getElementById('modeToggle');

  // Custom user palette: { background, holder, text } — applies in both modes
  const DEFAULT_CUSTOM = ['#000000', '#101010', '#b7b7b7'];
  function customPalette() {
    try {
      const raw = localStorage.getItem('custom_theme');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.background && parsed.holder && parsed.text) {
        return [parsed.background, parsed.holder, parsed.text];
      }
    } catch {
      /* fall through to defaults */
    }
    return DEFAULT_CUSTOM;
  }

  function setCustomColors(background, holder, text) {
    try {
      localStorage.setItem('custom_theme', JSON.stringify({ background, holder, text }));
      localStorage.setItem('current_theme', 'custom');
    } catch {
      /* storage unavailable — palette still applies for this session via `current_theme` below */
    }
    // Reflect the values immediately, even if storage was blocked
    document.documentElement.style.setProperty('--background', background);
    document.documentElement.style.setProperty('--holder', holder);
    document.documentElement.style.setProperty('--text', text);
    paint(getMode());
    syncSwatches();
  }

  // Paint the saved theme (or the defaults) in a mode, without saving anything
  function paint(mode) {
    root.setAttribute('data-theme', mode);
    const name = safeGet('current_theme');
    const palette = name === 'custom' ? customPalette() : PALETTES[name]?.[mode];
    PROPS.forEach((prop, i) => (palette ? root.style.setProperty(prop, palette[i]) : root.style.removeProperty(prop)));
  }

  function syncSwatches() {
    const active = safeGet('current_theme') || '';
    document.querySelectorAll('.theme-swatch').forEach((btn) => {
      const on = (btn.dataset.themeName || '') === active;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-checked', String(on));
    });
  }

  // Paint the current mode and keep the toggle + swatches in sync
  function apply() {
    paint(getMode());
    const toggle = getToggle();
    if (toggle) toggle.checked = getMode() === 'dark';
    syncSwatches();
  }

  function setMode(mode) {
    mode = mode === 'light' ? 'light' : 'dark';
    root.setAttribute('data-theme', mode); // set first — apply() paints from the attribute
    safeSet('data-theme', mode);
    apply();
  }

  function setTheme(name) {
    if (name && (name in PALETTES || name === 'custom')) safeSet('current_theme', name);
    else safeSet('current_theme', null);
    apply();
  }

  /* ---------- Light/dark switch as a top-to-bottom reveal ---------- */
  const SWIPE_MS = 550;
  let finishSwipe = null;

  // Every variable that light/dark or a theme changes
  function themeVarNames() {
    const names = new Set(PROPS);
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin stylesheet (none in this app)
      }
      for (const rule of rules) {
        if (!rule.selectorText) continue;
        const selector = rule.selectorText.replace(/'/g, '"');
        if (selector !== '[data-theme="light"]') continue;
        for (const prop of rule.style) if (prop.startsWith('--')) names.add(prop);
      }
    }
    return names;
  }

  // A static copy of the visible page, painted with the current theme variables
  function pageCopy() {
    const sheet = document.createElement('div');
    sheet.className = 'mode-swipe-sheet';
    sheet.setAttribute('aria-hidden', 'true');

    const css = getComputedStyle(root);
    themeVarNames().forEach((name) => sheet.style.setProperty(name, css.getPropertyValue(name)));

    for (const node of document.body.children) {
      if (node.matches('script, iframe, audio, video, .mode-swipe-sheet')) continue;
      const copy = node.cloneNode(true);
      copy.querySelectorAll('script, iframe, audio, video, .top-flip, .bottom-flip').forEach((n) => n.remove());
      // Mid-flip, a card's top half already shows the new number while its
      // bottom half waits for the leaf — the copy has no leaves, so show it landed.
      // Preserve each half's .glyph wrapper (un-wrapped text loses the centering).
      copy.querySelectorAll('.flip-card').forEach((card) => {
        const topGlyph = card.querySelector('.top .glyph');
        const bottomGlyph = card.querySelector('.bottom .glyph');
        if (topGlyph && bottomGlyph) bottomGlyph.textContent = topGlyph.textContent;
      });
      // cloneNode copies attributes, not live input state (slider value, toggles)
      const live = node.querySelectorAll('input');
      copy.querySelectorAll('input').forEach((input, i) => {
        input.value = live[i].value;
        input.checked = live[i].checked;
      });
      sheet.append(copy);
    }
    return sheet;
  }

  // Change the live page with its CSS transitions off (one silent frame under the copy)
  function withoutTransitions(change) {
    root.classList.add('mode-swipe-instant');
    change();
    void root.offsetHeight; // flush styles before transitions come back
    root.classList.remove('mode-swipe-instant');
  }

  function swipeToMode(mode) {
    if (finishSwipe) finishSwipe();
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || mode === getMode() || !Element.prototype.animate) return setMode(mode);

    const oldPage = pageCopy();
    document.body.append(oldPage);
    withoutTransitions(() => setMode(mode));

    const reveal = oldPage.animate(
      [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(100% 0 0 0)' }],
      { duration: SWIPE_MS, easing: 'cubic-bezier(.65, 0, .35, 1)', fill: 'forwards' }
    );
    const finish = () => {
      reveal.cancel();
      oldPage.remove();
      if (finishSwipe === finish) finishSwipe = null;
    };
    finishSwipe = finish;
    reveal.finished.then(finish, finish);
    // Safety net: hidden/throttled tabs may never run the animation — remove the sheet anyway
    window.setTimeout(finish, SWIPE_MS + 200);
  }

  /* ---------- Boot: apply saved theme before first paint ---------- */
  const savedMode = safeGet('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  root.setAttribute('data-theme', savedMode);
  paint(savedMode);

  document.addEventListener('DOMContentLoaded', () => {
    apply(); // now the toggle + swatches exist — sync them
    getToggle()?.addEventListener('change', (e) => swipeToMode(e.target.checked ? 'dark' : 'light'));
    document.querySelectorAll('.theme-swatch').forEach((btn) => {
      btn.addEventListener('click', () => setTheme(btn.dataset.themeName || null));
    });
  });

  return { setMode, setTheme, swipeToMode, getMode, setCustomColors };
})();
