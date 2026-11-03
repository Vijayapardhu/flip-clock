'use strict';

/**
 * Flip Clock — app logic
 *
 * One flip engine, three faces sharing the same cards:
 *   clock     — hours / minutes / (seconds) + AM-PM
 *   stopwatch — counts up
 *   timer     — counts down, optional +Nm presets, chime at zero
 *
 * Settings persist in localStorage: scale, 24h format, seconds visibility, mute.
 * The service worker keeps the whole app playable offline.
 */

const $ = (selector, context) => (context || document).querySelector(selector);
const $all = (selector, context) => Array.from((context || document).querySelectorAll(selector));
const pad2 = (n) => String(n).padStart(2, '0');
const REDUCED_MOTION = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode — non-fatal */
    }
  },
};

/* ==========================================================================
   Lo-fi — which stream to embed (change to any YouTube live stream id)
   ========================================================================== */
const LOFI = {
  code: 'jfKfPfyJRdk', // lofi hip hop radio 📚 beats to relax/study to
  name: 'lofi hip hop radio — beats to relax/study to',
};

/* ==========================================================================
   Elements
   ========================================================================== */
const stage = $('#stage');
const hourHolder = $('#hourHolder');
const secondHolder = $('#secondHolder');
const hourCard = $('#card-hours');
const minuteCard = $('#card-minutes');
const secondCard = $('#card-seconds');
const ampmEl = $('#ampm');
const liveTime = $('#liveTime');
const controls = $('#controls');
const menuToggle = $('#menuToggle');
const menuClose = $('#menuClose');
const sizeSlider = $('#size_range_slider');
const sizeValue = $('#sizeValue');
const formatButtons = $all('#formatToggle [data-format]');
const secondsToggle = $('#secondsToggle');
const flipSoundToggle = $('#flipSoundToggle');
const panelCloseBtn = $('#panelClose');
const fullscreenBtn = $('#fullscreenBtn');
const winMinimize = $('#winMinimize');
const winMaximize = $('#winMaximize');
const winClose = $('#winClose');
const lofiButton = $('#lofi_button');
const timerBtn = $('#timerBtn');
const stopwatchBtn = $('#stopwatchBtn');
const homeBtn = $('#homeBtn');

const timerControls = $('#timerControls');
const timeSlider = $('#time-slider');
const timeSliderRow = $('#timeSliderRow');
const sliderMarks = $all('.slider-marks span');
const startBtn = $('#start-btn');
const pauseBtn = $('#pause-btn');
const resetBtn = $('#reset-btn');
const shortcutsBtn = $('#shortcutsBtn');
const shortcutsModal = $('#shortcutsModal');
const closeShortcutsBtn = $('#closeShortcuts');
const updateToast = $('#updateToast');
const reloadBtn = $('#reloadBtn');

const customBg = $('#customBg');
const customHolder = $('#customHolder');
const customText = $('#customText');
const autoThemeToggle = $('#autoThemeToggle');
const autoHideToggle = $('#autoHideToggle');
const showDateToggle = $('#showDateToggle');
const ambientToggle = $('#ambientToggle');
const wakeToggle = $('#wakeToggle');
const pomoFocusBtn = $('#pomoFocusBtn');
const pomoBreakBtn = $('#pomoBreakBtn');
const focusStatsEl = $('#focusStats');
const dateLine = $('#dateLine');
const modeToggleEl = $('#modeToggle');

const lofiContainer = $('#lofi_container');
const lofiPlayer = $('#lofi_player');
const lofiCloseButton = $('#lofi_close_button');
$('#lofi_name').textContent = LOFI.name;

/* ==========================================================================
   Persisted state
   ========================================================================== */
let clockScale = Number(store.get('clock_scale', '100'));
if (!Number.isFinite(clockScale)) clockScale = 100;
clockScale = Math.min(120, Math.max(25, clockScale));

let use24h = store.get('use_24h', 'false') === 'true';
let showSeconds = store.get('show_seconds', 'true') === 'true'; // matches the flipclock.app showcase
let muted = store.get('flip_muted', 'false') === 'true';
let showDate = store.get('show_date', '1') === '1';
let autoHideEnabled = store.get('auto_hide', '0') === '1';
let autoTheme = store.get('theme_auto', '0') === '1';
let wantWake = store.get('wake_want', '0') === '1';
let ambientOn = store.get('ambient_on', '0') === '1';

/* ==========================================================================
   Flip engine — top leaf folds away from rest; bottom leaf keeps falling,
   lands with a small rebound. Returns whether the card changed.
   ========================================================================== */
function flip(card, newText) {
  const topHalf = card.querySelector('.top');
  const startText = topHalf.textContent;
  if (newText === startText) return false;

  const glyphOf = (half) => half.querySelector('.glyph') || half;

  if (REDUCED_MOTION()) {
    glyphOf(card.querySelector('.bottom')).textContent = newText;
    glyphOf(topHalf).textContent = newText;
    return true;
  }

  const bottomHalf = card.querySelector('.bottom');
  const renderLeaf = (className, text) => {
    const leaf = document.createElement('div');
    leaf.className = className;
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.textContent = text;
    leaf.append(glyph);
    return leaf;
  };
  const topFlip = renderLeaf('top-flip', startText);
  const bottomFlip = renderLeaf('bottom-flip', newText);

  glyphOf(topHalf).textContent = newText; // revealed as the old leaf falls away

  // Safety net: if animationend is missed (tab hidden mid-flip), settle anyway
  const settle = () => {
    glyphOf(bottomHalf).textContent = newText;
    topFlip.remove();
    bottomFlip.remove();
  };
  topFlip.addEventListener('animationend', () => topFlip.remove(), { once: true });
  bottomFlip.addEventListener('animationend', () => {
    glyphOf(bottomHalf).textContent = newText;
    bottomFlip.remove();
  }, { once: true });
  window.setTimeout(settle, 1000);

  card.append(topFlip, bottomFlip);
  return true;
}

function applyToCards(hour, minute, second, includeHour) {
  // Evaluate every card (flip() has side effects), then play one click for the whole change
  let flipped = false;
  flipped = flip(minuteCard, minute) || flipped;
  flipped = flip(secondCard, second) || flipped;
  if (includeHour) flipped = flip(hourCard, hour) || flipped;
  if (flipped && !muted) {
    window.setTimeout(() => FlipSounds.play(), FlipSounds.landingDelay());
  }
}

/* ==========================================================================
   Mode state machine: clock | stopwatch | timer
   ========================================================================== */
let mode = 'clock';

const sw = { startedAt: 0, accumulated: 0, running: false };
const DEFAULT_TIMER_MINUTES = 15;
const timer = { durationMs: DEFAULT_TIMER_MINUTES * 60 * 1000, remainingMs: DEFAULT_TIMER_MINUTES * 60 * 1000, endAt: 0, running: false };
// True while the user is dragging the timer minute slider — the flip face stays frozen
let timeSliderActive = false;
let timeSliderIdleTimer = null;

function mmssParts(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return { minute: pad2(minutes), second: pad2(seconds) };
}

function computeModeParts() {
  const now = Date.now();
  if (mode === 'stopwatch') {
    const elapsed = sw.running ? now - sw.startedAt + sw.accumulated : sw.accumulated;
    return mmssParts(Math.floor(elapsed / 1000));
  }
  if (mode === 'timer') {
    const remaining = timer.running ? Math.max(0, timer.endAt - now) : timer.remainingMs;
    return mmssParts(Math.ceil(remaining / 1000));
  }
  return null;
}

function clockParts(date) {
  let h = date.getHours();
  const pm = h >= 12;
  if (!use24h) h = h % 12 || 12;
  return {
    hour: String(h),
    minute: pad2(date.getMinutes()),
    second: pad2(date.getSeconds()),
    ampm: pm ? 'PM' : 'AM',
  };
}

function tick() {
  renderDate(); // glanceable date line — cheap, runs at most 4×/second
  if (mode === 'clock') {
    const p = clockParts(new Date());
    applyToCards(p.hour, p.minute, p.second, true);
    const ampm = use24h ? '' : p.ampm;
    if (ampmEl.textContent !== ampm) ampmEl.textContent = ampm;
    stage.classList.toggle('use-24h', use24h);
    const now = new Date();
    liveTime.textContent = `${use24h ? pad2(now.getHours()) : pad2(now.getHours() % 12 || 12)}:${p.minute}:${p.second}`;
    return;
  }

  const p = computeModeParts();
  if (!p) return;

  // While the user is dragging the timer slider, keep the face on the previous value
  if (mode === 'timer' && timeSliderActive) return;

  // Timer hitting zero: stop, stay at 00:00, chime, log the focus session
  if (mode === 'timer' && timer.running && timer.endAt - Date.now() <= 0) {
    timer.running = false;
    timer.remainingMs = 0;
    FlipSounds.playChime();
    updateRunButtons();
    recordFocusSession(Math.max(1, Math.round(timer.durationMs / 60000)));
  }

  applyToCards('00', p.minute, p.second, false);
  liveTime.textContent = `${p.minute}:${p.second}`;
}

/* ==========================================================================
   Seconds visibility (clock mode only — timer/stopwatch always show seconds)
   ========================================================================== */
function updateSecondsVisibility() {
  const inClock = mode === 'clock';
  const visible = inClock ? showSeconds : true;
  stage.classList.toggle('show-seconds', visible);
  secondsToggle.checked = visible;
  secondsToggle.disabled = !inClock; // always on in timer & stopwatch
  secondsToggle.closest('.pref-row')?.classList.toggle('pref-row--disabled', !inClock);
}

function updateRunButtons() {
  const running = mode === 'timer' ? timer.running : sw.running;
  startBtn.classList.toggle('hide', running);
  pauseBtn.classList.toggle('hide', !running);
}

function setMode(next) {
  if (next !== 'clock' && next === mode) next = 'clock'; // clicking the active mode button returns to the clock
  mode = next;
  stage.dataset.mode = mode;
  document.body.dataset.mode = mode;

  const inClock = mode === 'clock';
  store.set('last_mode', mode); // remembered across reloads
  // Bottom bar: clock mode shows the timer/stopwatch buttons, other modes show Home
  timerBtn.classList.toggle('hide', !inClock);
  stopwatchBtn.classList.toggle('hide', !inClock);
  homeBtn.classList.toggle('hide', inClock);

  // The settings panel carries the run controls for non-clock modes (opened by default, like the reference page)
  timerControls.classList.toggle('hide', inClock);
  timeSliderRow.classList.toggle('hide', mode !== 'timer'); // the minute slider is timer-only
  setControlsOpen(!inClock);

  timerBtn.setAttribute('aria-pressed', String(mode === 'timer'));
  stopwatchBtn.setAttribute('aria-pressed', String(mode === 'stopwatch'));

  updateSecondsVisibility();
  updateRunButtons();
  tick(); // refresh cards immediately
}

/* ==========================================================================
   Settings panel
   ========================================================================== */
function setControlsOpen(open) {
  controls.classList.toggle('close', !open);
  menuToggle.classList.toggle('hide', open);
  menuClose.classList.toggle('hide', !open);
  menuToggle.setAttribute('aria-expanded', String(open));
}

const isControlsOpen = () => !controls.classList.contains('close');

menuToggle.addEventListener('click', () => setControlsOpen(true));
menuClose.addEventListener('click', () => setControlsOpen(false));
panelCloseBtn.addEventListener('click', () => setControlsOpen(false));

// Clicking anywhere outside the panel (and not on the toggle) closes it
document.addEventListener('pointerdown', (event) => {
  if (!isControlsOpen()) return;
  if (controls.contains(event.target) || menuToggle.contains(event.target) || menuClose.contains(event.target)) return;
  setControlsOpen(false);
});

/* Clock size slider (transform on the stage) */
function applyScale(value) {
  clockScale = Math.min(120, Math.max(25, Number(value) || 100));
  stage.style.setProperty('--clock-scale', String(clockScale / 100));
  sizeValue.textContent = `${clockScale}%`;
  store.set('clock_scale', String(clockScale));
}

sizeSlider.addEventListener('input', () => applyScale(sizeSlider.value));

/* 12 / 24-hour segmented control */
function syncFormatButtons() {
  formatButtons.forEach((btn) => {
    const active = (btn.dataset.format === '24') === use24h;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

formatButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    use24h = btn.dataset.format === '24';
    store.set('use_24h', String(use24h));
    syncFormatButtons();
    tick();
  });
});

/* Seconds switch */
secondsToggle.addEventListener('change', () => {
  showSeconds = secondsToggle.checked;
  store.set('show_seconds', String(showSeconds));
  updateSecondsVisibility();
  tick();
});

/* Flip sound switch */
flipSoundToggle.addEventListener('change', () => {
  muted = !flipSoundToggle.checked;
  store.set('flip_muted', String(muted));
});

/* Fullscreen */
fullscreenBtn.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    /* fullscreen can be rejected (e.g. unsupported) - nothing else to do */
  }
});

/* ==========================================================================
   Desktop shell — the page's own titlebar (only present inside the
   frameless Electron window; browsers never expose window.desktop)
   ========================================================================== */
if (window.desktop) {
  const setMaximized = (maximized) => {
    document.documentElement.classList.toggle('is-maximized', maximized);
    if (winMaximize) {
      winMaximize.title = maximized ? 'Restore' : 'Maximize';
      winMaximize.setAttribute('aria-label', maximized ? 'Restore window' : 'Maximize window');
    }
  };

  winMinimize?.addEventListener('click', () => window.desktop.minimize());
  winMaximize?.addEventListener('click', () => window.desktop.toggleMaximize());
  winClose?.addEventListener('click', () => window.desktop.close());
  window.desktop.onMaximized?.(setMaximized);
  window.desktop.isMaximized?.().then(setMaximized).catch(() => {});
}

/* ==========================================================================
   Lo-fi player — opened lazily, draggable by its frame, stops on close
   ========================================================================== */
const lofiState = { x: 0, y: 0, dragging: false, offsetX: 0, offsetY: 0 };

function setLofiOpen(open) {
  if (open) {
    if (!lofiPlayer.src) lofiPlayer.src = `https://www.youtube.com/embed/${LOFI.code}?autoplay=1&rel=0`;
    lofiContainer.classList.remove('hide');
  } else {
    lofiContainer.classList.add('hide');
    lofiPlayer.src = ''; // stop playback
  }
}

// The lo-fi button is intentionally not in the panel for now — the player code stays ready for when it returns.
lofiButton?.addEventListener('click', () => setLofiOpen(lofiContainer.classList.contains('hide')));
// Native button semantics: Enter/Space fire 'click' for free
lofiCloseButton.addEventListener('click', () => setLofiOpen(false));

lofiContainer.addEventListener('pointerdown', (event) => {
  // Never start a drag (which would swallow the click) when pressing a real control
  if (event.target.closest('iframe, a, button, .lofi-close')) return;
  lofiState.dragging = true;
  lofiState.offsetX = event.clientX - lofiState.x;
  lofiState.offsetY = event.clientY - lofiState.y;
  lofiContainer.setPointerCapture(event.pointerId);
  lofiContainer.style.cursor = 'grabbing';
});

lofiContainer.addEventListener('pointermove', (event) => {
  if (!lofiState.dragging) return;
  lofiState.x = event.clientX - lofiState.offsetX;
  lofiState.y = event.clientY - lofiState.offsetY;
  lofiContainer.style.transform = `translate(${lofiState.x}px, ${lofiState.y}px)`;
});

const stopLofiDrag = () => {
  lofiState.dragging = false;
  lofiContainer.style.cursor = 'grab';
};

lofiContainer.addEventListener('pointerup', stopLofiDrag);
lofiContainer.addEventListener('pointercancel', stopLofiDrag);

/* ==========================================================================
   Shortcuts modal
   ========================================================================== */
const setShortcutsOpen = (open) => {
  shortcutsModal.classList.toggle('hide', !open);
  shortcutsBtn.setAttribute('aria-expanded', String(open));
};
const isShortcutsOpen = () => !shortcutsModal.classList.contains('hide');

shortcutsBtn.addEventListener('click', () => setShortcutsOpen(shortcutsModal.classList.contains('hide')));
closeShortcutsBtn.addEventListener('click', () => setShortcutsOpen(false));
shortcutsModal.addEventListener('pointerdown', (event) => {
  if (event.target === shortcutsModal) setShortcutsOpen(false); // click the backdrop
});

/* ==========================================================================
   Timer / stopwatch — the clock face becomes a count-up / count-down
   ========================================================================== */
timerBtn.addEventListener('click', () => setMode('timer'));
stopwatchBtn.addEventListener('click', () => setMode('stopwatch'));
homeBtn.addEventListener('click', () => setMode('clock'));

/* Minute slider (timer only) — drag or click the 01/15/30/45/60 marks.
   While dragging, the flip face stays frozen on the old value; the new value
   flips in once the user lets go (or after a short idle). */
function updateSliderMarks(value) {
  sliderMarks.forEach((mark) => mark.classList.toggle('active', Number(mark.dataset.value) === value));
}

function applyTimerMinutes(mins, render = true) {
  const m = Math.min(60, Math.max(1, Math.floor(mins) || DEFAULT_TIMER_MINUTES));
  timer.durationMs = m * 60 * 1000;
  if (timer.running) {
    timer.endAt = Date.now() + m * 60 * 1000; // dragging mid-run adjusts the countdown live
  } else {
    timer.remainingMs = m * 60 * 1000;
  }
  updateSliderMarks(m);
  liveTime.textContent = `${pad2(m)}:00`; // update the screen-reader text silently; cards stay frozen
  if (render) tick();
}

timeSlider.addEventListener('input', () => {
  timeSliderActive = true;
  applyTimerMinutes(Number(timeSlider.value), false);
  window.clearTimeout(timeSliderIdleTimer);
  // Commit 180ms after the last movement — covers pointer drags and keyboard arrows
  timeSliderIdleTimer = window.setTimeout(() => {
    timeSliderActive = false;
    tick();
  }, 180);
});

timeSlider.addEventListener('change', () => {
  timeSliderActive = false;
  window.clearTimeout(timeSliderIdleTimer);
  tick(); // flip to the committed value, exactly once
});
sliderMarks.forEach((mark) => {
  mark.addEventListener('click', () => {
    timeSlider.value = mark.dataset.value;
    applyTimerMinutes(Number(mark.dataset.value));
  });
});

function startRun() {
  if (mode === 'timer') {
    if (timer.remainingMs <= 0) timer.remainingMs = timer.durationMs;
    timer.endAt = Date.now() + timer.remainingMs;
    timer.running = true;
  } else if (mode === 'stopwatch') {
    sw.startedAt = Date.now();
    sw.running = true;
  }
  updateRunButtons();
  tick();
}

function pauseRun() {
  if (mode === 'timer') {
    timer.remainingMs = Math.max(0, timer.endAt - Date.now());
    timer.running = false;
  } else if (mode === 'stopwatch') {
    sw.accumulated += Date.now() - sw.startedAt;
    sw.running = false;
  }
  updateRunButtons();
  tick();
}

startBtn.addEventListener('click', startRun);
pauseBtn.addEventListener('click', pauseRun);

resetBtn.addEventListener('click', () => {
  if (mode === 'timer') {
    timer.running = false;
    timer.remainingMs = timer.durationMs;
    timeSlider.value = String(Math.round(timer.durationMs / 60000));
    updateSliderMarks(Number(timeSlider.value));
  } else if (mode === 'stopwatch') {
    sw.running = false;
    sw.accumulated = 0;
    sw.startedAt = 0;
  }
  updateRunButtons();
  tick();
});

/* ==========================================================================
   Keyboard shortcuts
   ========================================================================== */
window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  switch (event.key.toLowerCase()) {
    case ',':
    case 's':
      event.preventDefault();
      setControlsOpen(!isControlsOpen());
      break;
    case '?':
      event.preventDefault();
      setShortcutsOpen(!isShortcutsOpen());
      break;
    case 'escape':
      setControlsOpen(false);
      setShortcutsOpen(false);
      break;
    case 'f':
      fullscreenBtn.click();
      break;
    case 'm': {
      const next = !muted;
      muted = next;
      store.set('flip_muted', String(next));
      flipSoundToggle.checked = !muted;
      break;
    }
    case 't':
      setMode('timer');
      break;
    case 'w':
      setMode('stopwatch');
      break;
    case 'c':
      setMode('clock');
      break;
    default:
      break;
  }
});

/* ==========================================================================
   Custom theme builder — background / card / digit colors
   ========================================================================== */
function readCustomFromStore() {
  try {
    const raw = localStorage.getItem('custom_theme');
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.background && parsed.holder && parsed.text) return parsed;
  } catch {
    /* fall through */
  }
  return { background: '#000000', holder: '#101010', text: '#b7b7b7' };
}

function syncCustomInputs() {
  const custom = readCustomFromStore();
  customBg.value = custom.background;
  customHolder.value = custom.holder;
  customText.value = custom.text;
}

[customBg, customHolder, customText].forEach((input) => {
  input.addEventListener('input', () => {
    FlipThemes.setCustomColors(customBg.value, customHolder.value, customText.value);
  });
});

/* ==========================================================================
   Focus stats — sessions & minutes per day (timer completions)
   ========================================================================== */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function loadFocusStats() {
  try {
    const raw = localStorage.getItem('focus_stats');
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.date === todayKey()) return parsed;
    return { date: todayKey(), sessions: 0, minutes: 0 };
  } catch {
    return { date: todayKey(), sessions: 0, minutes: 0 };
  }
}

let focusStats = loadFocusStats();

function renderFocusStats() {
  if (!focusStatsEl) return;
  focusStatsEl.textContent = `Today · ${focusStats.sessions} ${focusStats.sessions === 1 ? 'session' : 'sessions'} · ${focusStats.minutes} min`;
}

function recordFocusSession(minutes) {
  if (focusStats.date !== todayKey()) focusStats = { date: todayKey(), sessions: 0, minutes: 0 };
  focusStats.sessions += 1;
  focusStats.minutes += minutes;
  try {
    localStorage.setItem('focus_stats', JSON.stringify(focusStats));
  } catch {
    /* storage unavailable — keep in-memory for this session */
  }
  renderFocusStats();
}

/* ==========================================================================
   Ambient brown noise — a soft generated rumble, no audio files
   ========================================================================== */
let noiseCtx = null;
let noiseGain = null;
let brownNoiseBuffer = null;

function getBrownNoiseBuffer(ctx) {
  if (brownNoiseBuffer) return brownNoiseBuffer;
  const size = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
  const out = buffer.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < size; i += 1) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02; // leaky integrator — the "brown" in brown noise
    out[i] = lastOut * 3.5;
  }
  brownNoiseBuffer = buffer;
  return buffer;
}

function syncAmbientButton() {
  ambientToggle.checked = ambientOn;
}

function setAmbient(on) {
  ambientOn = on;
  store.set('ambient_on', ambientOn ? '1' : '0');
  syncAmbientButton();

  if (on) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      ambientOn = false;
      store.set('ambient_on', '0');
      syncAmbientButton();
      return;
    }
    if (!noiseCtx) noiseCtx = new AudioContextClass();
    if (noiseCtx.state === 'suspended') noiseCtx.resume();
    if (!noiseGain) {
      const source = noiseCtx.createBufferSource();
      source.buffer = getBrownNoiseBuffer(noiseCtx);
      source.loop = true;

      const lowpass = noiseCtx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 750; // keep it soft — rumble, not hiss

      noiseGain = noiseCtx.createGain();
      noiseGain.gain.setValueAtTime(0, noiseCtx.currentTime);
      noiseGain.gain.linearRampToValueAtTime(0.17, noiseCtx.currentTime + 0.4);

      source.connect(lowpass);
      lowpass.connect(noiseGain);
      noiseGain.connect(noiseCtx.destination);
      source.start();
    }
    return;
  }

  // Fade out — don't just cut the rumble
  if (noiseCtx && noiseGain) {
    const t = noiseCtx.currentTime;
    noiseGain.gain.cancelScheduledValues(t);
    noiseGain.gain.setValueAtTime(noiseGain.gain.value, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    const closing = noiseCtx;
    noiseCtx = null;
    noiseGain = null;
    window.setTimeout(() => closing.close().catch(() => {}), 350);
  }
}

ambientToggle.addEventListener('change', () => setAmbient(ambientToggle.checked));
syncAmbientButton();

// Resume ambient sound after the first user gesture (autoplay policies)
if (ambientOn) {
  const resume = () => setAmbient(true);
  window.addEventListener('pointerdown', resume, { once: true });
}

/* ==========================================================================
   Keep the screen awake — Wake Lock API
   ========================================================================== */
const wakeSupported = 'wakeLock' in navigator;
let wakeSentinel = null;

function syncWakeButton(on) {
  wakeToggle.checked = on;
}

function handleWakeReleased() {
  wakeSentinel = null;
  syncWakeButton(false);
  // If the user wanted it on but the OS dropped the lock (e.g. tab hidden), re-arm on return
}

async function requestWakeLock() {
  try {
    wakeSentinel = await navigator.wakeLock.request('screen');
    wakeSentinel.addEventListener('release', handleWakeReleased);
    syncWakeButton(true);
  } catch {
    syncWakeButton(false); // denied / low battery / etc.
  }
}

async function releaseWakeLock() {
  if (wakeSentinel) {
    try {
      await wakeSentinel.release();
    } catch {
      /* already released */
    }
    wakeSentinel = null;
  }
  syncWakeButton(false);
}

wakeToggle.addEventListener('change', () => {
  wantWake = wakeToggle.checked;
  store.set('wake_want', wantWake ? '1' : '0');
  if (wantWake) requestWakeLock();
  else releaseWakeLock();
});

if (!wakeSupported) {
  wakeToggle.closest('.pref-row')?.classList.add('pref-row--disabled');
  wakeToggle.closest('.pref-row')?.setAttribute('title', 'Wake Lock is not supported in this browser');
  wakeToggle.disabled = true;
} else {
  wakeToggle.checked = wantWake;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wantWake && !wakeSentinel) requestWakeLock();
  });
  if (wantWake) requestWakeLock();
}

/* ==========================================================================
   Auto-hide UI (screensaver mode)
   ========================================================================== */
const AUTO_HIDE_MS = 4500;
let idleTimer = null;

function clearUiHidden() {
  document.body.classList.remove('ui-hidden');
}

function armIdleTimer() {
  window.clearTimeout(idleTimer);
  if (!autoHideEnabled) return;
  idleTimer = window.setTimeout(() => document.body.classList.add('ui-hidden'), AUTO_HIDE_MS);
}

['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((evt) => {
  window.addEventListener(evt, () => {
    clearUiHidden();
    armIdleTimer();
  }, { passive: true });
});

autoHideToggle.checked = autoHideEnabled;
autoHideToggle.addEventListener('change', () => {
  autoHideEnabled = autoHideToggle.checked;
  store.set('auto_hide', autoHideEnabled ? '1' : '0');
  clearUiHidden();
  armIdleTimer();
});

/* ==========================================================================
   Follow system appearance (auto light / dark)
   ========================================================================== */
const systemScheme = window.matchMedia('(prefers-color-scheme: light)');

function applySystemTheme() {
  FlipThemes.swipeToMode(systemScheme.matches ? 'light' : 'dark');
}

systemScheme.addEventListener('change', () => {
  if (autoTheme) applySystemTheme();
});

// Manual override on the sun/moon toggle turns auto off
modeToggleEl.addEventListener('change', () => {
  if (autoTheme) {
    autoTheme = false;
    autoThemeToggle.checked = false;
    store.set('theme_auto', '0');
  }
});

autoThemeToggle.checked = autoTheme;
autoThemeToggle.addEventListener('change', () => {
  autoTheme = autoThemeToggle.checked;
  store.set('theme_auto', autoTheme ? '1' : '0');
  if (autoTheme) applySystemTheme();
});

/* ==========================================================================
   Date line
   ========================================================================== */
function renderDate() {
  if (!showDate) {
    dateLine.style.display = 'none';
    return;
  }
  dateLine.style.display = '';
  const d = new Date();
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  dateLine.textContent = `${weekday} · ${month} ${d.getDate()}`;
}

showDateToggle.checked = showDate;
showDateToggle.addEventListener('change', () => {
  showDate = showDateToggle.checked;
  store.set('show_date', showDate ? '1' : '0');
  renderDate();
});

/* ==========================================================================
   Pomodoro quick-set chips (timer mode)
   ========================================================================== */
pomoFocusBtn.addEventListener('click', () => {
  timeSlider.value = '25';
  applyTimerMinutes(25);
});

pomoBreakBtn.addEventListener('click', () => {
  timeSlider.value = '5';
  applyTimerMinutes(5);
});

/* ==========================================================================
   Init
   ========================================================================== */
function init() {
  // Apply persisted scale before first paint
  stage.style.setProperty('--clock-scale', String(clockScale / 100));
  sizeSlider.value = String(clockScale);

  applyScale(clockScale);
  syncFormatButtons();
  flipSoundToggle.checked = !muted;
  updateSecondsVisibility();
  updateRunButtons();
  updateSliderMarks(Number(timeSlider.value));

  syncCustomInputs();
  renderFocusStats();
  renderDate();
  armIdleTimer();
  if (autoTheme) applySystemTheme(); // follow the OS on every launch

  // Resume the last mode (clock / timer / stopwatch)
  const lastMode = store.get('last_mode', 'clock');
  if (lastMode === 'timer' || lastMode === 'stopwatch') setMode(lastMode);

  // Keep cards honest when the tab was hidden
  document.addEventListener('visibilitychange', tick);
  window.setInterval(tick, 250);
  tick();
}

/* ==========================================================================
   Offline: register the service worker, toast when a new version is ready
   ========================================================================== */
window.addEventListener('load', () => {
  const isHttp = /^https?:$/.test(location.protocol);
  const hadController = Boolean(navigator.serviceWorker?.controller);
  if (!('serviceWorker' in navigator) || !isHttp) return;

  navigator.serviceWorker
    .register('service-worker.js')
    .then(() => {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'UPDATE_READY' && hadController) updateToast.classList.remove('hide');
      });
    })
    .catch(() => {
      /* offline support is best-effort; the app still runs */
    });
});

reloadBtn.addEventListener('click', () => window.location.reload());

init();
