'use strict';

/**
 * FlipClock — persistent settings store.
 *
 * Lives in <userData>/settings.json so it survives updates and can be edited
 * by hand or by an external dotfiles repo. The file is watched, so changes
 * take effect live without restarting the clock.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const Config = require('./config');

const WRITE_DEBOUNCE_MS = 120;

class SettingsStore {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.settings = Config.normalize({});
    this.listeners = new Set();
    this.writeTimer = 0;

    this._load();
    this._watch();
  }

  /** @returns {ReturnType<Config.normalize>} */
  get() {
    return this.settings;
  }

  /** Apply a nested patch (e.g. { appearance: { glyph: '#fff' } }). */
  patch(partial) {
    this.settings = Config.normalize(Config.merge(this.settings, partial));
    this._scheduleWrite();
    this._emit();
    return this.settings;
  }

  reset() {
    this.settings = Config.normalize({});
    this._scheduleWrite();
    this._emit();
    return this.settings;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // -------------------------------------------------------------------------

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.settings = Config.normalize(JSON.parse(raw));
    } catch (error) {
      // Missing or corrupt file: fall back to defaults and rewrite it, so the
      // user always has something valid to edit next time.
      this.settings = Config.normalize({});
      if (error.code !== 'ENOENT') this._write();
    }
  }

  _scheduleWrite() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = 0;
      this._write();
    }, WRITE_DEBOUNCE_MS);
  }

  _write() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const serialisable = JSON.parse(JSON.stringify(this.settings));
      delete serialisable.appearance.fontStack;
      delete serialisable.motion.easingCss;
      fs.writeFileSync(this.file, `${JSON.stringify(serialisable, null, 2)}\n`, 'utf8');
    } catch (error) {
      console.warn('[settings] could not write settings.json:', error.message);
    }
  }

  _watch() {
    try {
      fs.watchFile(this.file, { interval: 600 }, () => this._reloadFromDisk());
    } catch (error) {
      console.warn('[settings] file watching unavailable:', error.message);
    }
  }

  _reloadFromDisk() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const next = Config.normalize(JSON.parse(raw));
      if (JSON.stringify(next) === JSON.stringify(this.settings)) return;
      this.settings = next;
      this._emit();
    } catch (error) {
      // The editor is mid-write, or the file was deleted. Ignore.
    }
  }

  _emit() {
    for (const listener of this.listeners) {
      try {
        listener(this.settings);
      } catch (error) {
        console.warn('[settings] listener failed:', error.message);
      }
    }
  }
}

module.exports = SettingsStore;
