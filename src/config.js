'use strict';

/**
 * FlipClock — settings schema, presets, validation and resolution.
 *
 * The single source of truth for every configurable thing about the app. The
 * main process owns it; the renderer receives an already-resolved copy, so
 * presentation concerns (font stacks, easing curves) are never duplicated in
 * two places.
 */

const clamp = (n, min, max) => Math.min(Math.max(Number(n), min), max);

const isColor = (value) =>
  typeof value === 'string' &&
  /^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([^)]*\)|hsla?\([^)]*\)|transparent)$/i.test(
    value.trim(),
  );

/** Recursively merge `patch` onto `base`. Arrays replace; objects recurse. */
function merge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    const current = out[key];
    const isPlainObject =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value);
    if (isPlainObject && current !== null && typeof current === 'object' && !Array.isArray(current)) {
      out[key] = merge(current, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function setPath(target, path, value) {
  const keys = path.split('.');
  let node = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (node[keys[i]] === undefined || typeof node[keys[i]] !== 'object') {
      node[keys[i]] = {};
    }
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
  return target;
}

function getPath(source, path) {
  return path.split('.').reduce((node, key) => (node === undefined ? undefined : node[key]), source);
}

// ---------------------------------------------------------------------------
// Font stacks and easing curves. The renderer receives these already resolved.
// ---------------------------------------------------------------------------

const FONTS = {
  inter:
    '"Inter", "SF Pro Display", "Helvetica Neue", "Segoe UI Variable Display", "Segoe UI", Roboto, Arial, sans-serif',
  helvetica: '"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif',
  sf: '"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI Variable Display", "Segoe UI", Roboto, sans-serif',
  mono: '"Cascadia Code", "JetBrains Mono", "SF Mono", Consolas, "Courier New", monospace',
  serif: 'Georgia, "Times New Roman", serif',
};

const EASINGS = {
  standard: 'cubic-bezier(0.42, 0, 0.58, 1)',
  sharp: 'cubic-bezier(0.85, 0, 0.15, 1)',
  spring: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
  gentle: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
  time: {
    format: '24', // '24' | '12'
    showSeconds: true,
    showAmPm: true,
  },
  appearance: {
    background: '#0a0a0a',
    cardTopStart: '#26262a',
    cardTopEnd: '#1c1c20',
    cardBottomStart: '#17171b',
    cardBottomEnd: '#111114',
    glyph: '#f6f6f8',
    glyphShadow: 'rgba(0,0,0,0.55)',
    seamDark: 'rgba(0,0,0,0.95)',
    seamLight: 'rgba(255,255,255,0.06)',
    fontFamily: 'inter',
    fontWeight: 800,
    letterSpacing: -0.015, // in em
    fontScale: 0.92, // glyph size as a fraction of card height
    digitWidth: 0.66, // digit cell width as a fraction of card height
    panelGap: 0.26, // gap between panels as a fraction of card height
    radius: 0.1, // corner radius as a fraction of card height
    margin: 0.05, // free space kept around the clock, fraction of viewport
  },
  motion: {
    flipMs: 250,
    easing: 'standard',
    reducedMotion: 'auto', // 'auto' | 'on' | 'off'
  },
  behavior: {
    startFullscreen: false,
    alwaysOnTop: false,
    keepAwake: true,
    autoUpdate: true,
  },
};

// ---------------------------------------------------------------------------
// Style presets
// ---------------------------------------------------------------------------

const PRESETS = {
  classic: {
    background: '#0a0a0a',
    cardTopStart: '#26262a',
    cardTopEnd: '#1c1c20',
    cardBottomStart: '#17171b',
    cardBottomEnd: '#111114',
    glyph: '#f6f6f8',
    glyphShadow: 'rgba(0,0,0,0.55)',
    seamDark: 'rgba(0,0,0,0.95)',
    seamLight: 'rgba(255,255,255,0.06)',
    fontFamily: 'inter',
    fontWeight: 800,
    letterSpacing: -0.015,
    radius: 0.1,
  },
  midnight: {
    background: '#05070d',
    cardTopStart: '#1e2433',
    cardTopEnd: '#161b28',
    cardBottomStart: '#121724',
    cardBottomEnd: '#0d111b',
    glyph: '#e8edf8',
    glyphShadow: 'rgba(0,0,0,0.7)',
    seamDark: 'rgba(0,0,0,0.98)',
    seamLight: 'rgba(160,190,255,0.07)',
    fontFamily: 'sf',
    fontWeight: 700,
    letterSpacing: -0.01,
    radius: 0.14,
  },
  ember: {
    background: '#0a0705',
    cardTopStart: '#3a2a1b',
    cardTopEnd: '#2c2015',
    cardBottomStart: '#1e1712',
    cardBottomEnd: '#16110d',
    glyph: '#ffe7c2',
    glyphShadow: 'rgba(0,0,0,0.6)',
    seamDark: 'rgba(20,10,0,0.96)',
    seamLight: 'rgba(255,190,120,0.08)',
    fontFamily: 'helvetica',
    fontWeight: 800,
    letterSpacing: -0.02,
    radius: 0.08,
  },
  blueprint: {
    background: '#06111f',
    cardTopStart: '#12283f',
    cardTopEnd: '#0d1e30',
    cardBottomStart: '#0a1826',
    cardBottomEnd: '#07121c',
    glyph: '#dff2ff',
    glyphShadow: 'rgba(0,10,30,0.65)',
    seamDark: 'rgba(0,20,40,0.96)',
    seamLight: 'rgba(120,210,255,0.09)',
    fontFamily: 'mono',
    fontWeight: 600,
    letterSpacing: -0.03,
    radius: 0.04,
  },
  mono: {
    background: '#000000',
    cardTopStart: '#212121',
    cardTopEnd: '#171717',
    cardBottomStart: '#141414',
    cardBottomEnd: '#0d0d0d',
    glyph: '#ffffff',
    glyphShadow: 'rgba(0,0,0,0.6)',
    seamDark: 'rgba(0,0,0,1)',
    seamLight: 'rgba(255,255,255,0.05)',
    fontFamily: 'inter',
    fontWeight: 900,
    letterSpacing: -0.035,
    radius: 0.06,
  },
  sand: {
    background: '#100e0a',
    cardTopStart: '#4a443a',
    cardTopEnd: '#3b362e',
    cardBottomStart: '#2b2721',
    cardBottomEnd: '#1f1c18',
    glyph: '#fbf6ea',
    glyphShadow: 'rgba(0,0,0,0.5)',
    seamDark: 'rgba(20,16,8,0.92)',
    seamLight: 'rgba(255,240,210,0.08)',
    fontFamily: 'serif',
    fontWeight: 700,
    letterSpacing: -0.01,
    radius: 0.16,
  },
};

const PRESET_LABELS = {
  classic: 'Classic',
  midnight: 'Midnight',
  ember: 'Ember',
  blueprint: 'Blueprint',
  mono: 'Mono',
  sand: 'Sand',
};

// ---------------------------------------------------------------------------
// Validation — every knob has a hard range so a hand-edited settings.json can
// never produce an unusable window.
// ---------------------------------------------------------------------------

const RANGES = {
  'time.format': ['24', '12'],
  'motion.reducedMotion': ['auto', 'on', 'off'],
  'appearance.fontFamily': Object.keys(FONTS),
  'motion.easing': Object.keys(EASINGS),
};

const NUMERIC = {
  'appearance.fontWeight': [400, 900, 100],
  'appearance.letterSpacing': [-0.06, 0.12, 0.005],
  'appearance.fontScale': [0.6, 1.15, 0.01],
  'appearance.digitWidth': [0.45, 1.0, 0.01],
  'appearance.panelGap': [0.0, 0.6, 0.01],
  'appearance.radius': [0.0, 0.3, 0.01],
  'appearance.margin': [0.0, 0.25, 0.01],
  'motion.flipMs': [80, 800, 10],
};

const COLORS = [
  'appearance.background',
  'appearance.cardTopStart',
  'appearance.cardTopEnd',
  'appearance.cardBottomStart',
  'appearance.cardBottomEnd',
  'appearance.glyph',
  'appearance.glyphShadow',
  'appearance.seamDark',
  'appearance.seamLight',
];

const BOOLEANS = [
  'time.showSeconds',
  'time.showAmPm',
  'behavior.startFullscreen',
  'behavior.alwaysOnTop',
  'behavior.keepAwake',
  'behavior.autoUpdate',
];

/** Clamp, coerce and repair a raw settings object into a safe one. */
function normalize(raw) {
  const value = merge(DEFAULTS, raw || {});

  for (const [path, allowed] of Object.entries(RANGES)) {
    const current = getPath(value, path);
    if (typeof current !== 'string' || !allowed.includes(current)) {
      setPath(value, path, getPath(DEFAULTS, path));
    }
  }

  for (const [path, [min, max, step]] of Object.entries(NUMERIC)) {
    const current = getPath(value, path);
    const fallback = getPath(DEFAULTS, path);
    const parsed = Number(current);
    if (!Number.isFinite(parsed)) {
      setPath(value, path, fallback);
      continue;
    }
    const clamped = clamp(parsed, min, max);
    // Snap to the step grid so sliders never land between detents.
    const snapped = Math.round(clamped / step) * step;
    setPath(value, path, Number(snapped.toFixed(4)));
  }

  for (const path of COLORS) {
    const current = getPath(value, path);
    if (!isColor(current)) setPath(value, path, getPath(DEFAULTS, path));
  }

  for (const path of BOOLEANS) {
    const current = getPath(value, path);
    if (typeof current !== 'boolean') setPath(value, path, Boolean(getPath(DEFAULTS, path)));
  }

  if (typeof value.version !== 'number') value.version = DEFAULTS.version;

  return resolve(value);
}

/** Resolve presentation references so the renderer gets concrete values. */
function resolve(value) {
  return {
    ...value,
    appearance: {
      ...value.appearance,
      fontStack: FONTS[value.appearance.fontFamily] || FONTS.inter,
    },
    motion: {
      ...value.motion,
      easingCss: EASINGS[value.motion.easing] || EASINGS.standard,
    },
  };
}

module.exports = {
  DEFAULTS,
  PRESETS,
  PRESET_LABELS,
  FONTS,
  EASINGS,
  merge,
  setPath,
  getPath,
  normalize,
  resolve,
};
