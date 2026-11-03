'use strict';
/**
 * Flip Clock — flip sound engine (Web Audio API, no audio files)
 *
 * Each flip is two layered voices synthesized on the fly:
 *   • a short band-passed noise burst (the "click" of the leaf)
 *   • a low sine thump ~140-180 Hz (the "thock" of the card landing)
 * A little detune/random drift per flip keeps it mechanical, not digital.
 */
const FlipSounds = (() => {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let unlocked = false;

  function getContext() {
    if (!ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;

      ctx = new AudioContextClass();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);

      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Browsers only allow audio after a user gesture — unlock on the first one
  ['pointerdown', 'keydown', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, () => {
      unlocked = true;
      getContext();
    }, { once: true, passive: true });
  });

  const rand = (min, max) => min + Math.random() * (max - min);

  function play() {
    // Until the first interaction the browser keeps audio suspended;
    // skip instead of queueing a burst of clicks for later.
    const c = getContext();
    if (!c || !unlocked || c.state !== 'running') return;

    const t = c.currentTime + 0.002;

    // --- Click: band-passed noise with a fast-attack, quick-decay envelope ---
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;

    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.15;
    band.frequency.value = rand(1400, 2300);

    const high = c.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 380;

    const clickGain = c.createGain();
    clickGain.gain.setValueAtTime(0, t);
    clickGain.gain.linearRampToValueAtTime(rand(0.7, 1.0), t + 0.008);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + rand(0.11, 0.15));

    src.connect(band);
    band.connect(high);
    high.connect(clickGain);
    clickGain.connect(master);

    src.start(t, Math.random() * 0.6, 0.2);
    src.stop(t + 0.16);

    // --- Thump: short sine drop for the card hitting the seam ---
    const thump = c.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(rand(165, 195), t);
    thump.frequency.exponentialRampToValueAtTime(120, t + 0.12);

    const thumpGain = c.createGain();
    thumpGain.gain.setValueAtTime(0, t);
    thumpGain.gain.linearRampToValueAtTime(0.5, t + 0.006);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    thump.connect(thumpGain);
    thumpGain.connect(master);

    thump.start(t);
    thump.stop(t + 0.16);
  }

  // ms until a flip's bottom leaf lands (70% into its animation),
  // derived from the --flip-top-dur / --flip-bottom-dur custom properties.
  function landingDelay() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
    const css = getComputedStyle(document.documentElement);
    const num = (name) => parseFloat(css.getPropertyValue(name)) || 0;
    return Math.max(0, num('--flip-top-dur') + num('--flip-bottom-dur') * 0.7 + num('--flip-sound-offset'));
  }

  // A small three-note chime used when a timer completes.
  function playChime() {
    const c = getContext();
    if (!c || !unlocked || c.state !== 'running') return;

    const t0 = c.currentTime + 0.01;
    const notes = [880, 1108.73, 1318.51];
    notes.forEach((freq, i) => {
      const t = t0 + i * 0.22;
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const gain = c.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);

      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + 1);
    });
  }

  return { play, landingDelay, playChime };
})();
