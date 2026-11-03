# FlipClock

A minimal, hypnotic flip clock for focus and relaxation — as a fast static
website / offline PWA, and as a frameless Windows desktop app.

- Three flat flip cards with a crisp centre seam and a real top-to-bottom flip
- 11 palettes, light & dark modes, custom colours
- Clock, timer and stopwatch
- 12/24-hour format, optional seconds and flip sound
- Auto-hide UI, fullscreen and keyboard shortcuts
- Installable PWA with offline support
- Frameless desktop shell with a theme-aware titlebar ribbon, drag region and
  native minimise / maximise / close
- One executable icon generated from the same flip-card artwork

Website: https://vijayapardhu.github.io/flip-clock/

## Run it

```powershell
npm install

# desktop app (frameless shell around website/index.html)
npm start

# static website on http://localhost:3000
npm run serve
```

The old Electron-only renderer is kept in `src/` for reference and can still be
opened with `npm run start:classic`.

## Desktop window

- Default size: **1180 × 760**
- Minimum size: **380 × 560**
- No native menu bar: the page draws its own ribbon (`?shell=1`), themed with
  the active palette
- Links open in the default browser; the clock never navigates away
- F11 / `F` (or the fullscreen button) gives the clock the whole screen

## Controls

| Input | Action |
| --- | --- |
| `F` | Toggle fullscreen |
| `S` | Open / close settings |
| `T` | Timer |
| `W` | Stopwatch |
| `C` | Back to clock |
| `M` | Mute / unmute flip sound |
| `Esc` | Close overlays / exit fullscreen |

## Project layout

```
flip-clock/
├─ website/                 # the product website + PWA
│  ├─ index.html
│  ├─ styles.css            # card geometry, themes, responsive rules
│  ├─ app.js                # clock / timer / stopwatch, settings, shell bridge
│  ├─ themes.js             # palettes + pre-paint light/dark handling
│  ├─ sounds.js             # generated flip / chime sounds
│  ├─ service-worker.js     # offline cache
│  └─ assets/               # fonts + generated icons
├─ desktop/
│  ├─ main.js               # frameless BrowserWindow, IPC, size limits
│  └─ preload.js            # window.desktop bridge (5 safe methods)
├─ src/                     # legacy Electron renderer (reference)
├─ scripts/                 # icon generators, smoke tests, screenshots
├─ build/                   # icon.ico / icon.png for the packaged .exe
├─ .github/workflows/       # Pages deploy + tagged release builds
└─ package.json             # scripts + electron-builder config
```

## Build the Windows app

```powershell
npm run dist
```

Outputs in `dist/`:

- `FlipClock-Setup-1.4.0.exe` — installer with Start menu / desktop shortcuts
- `FlipClock-1.4.0-portable.exe` — no install, run from anywhere

The packaged app bundles `website/` and `desktop/` inside `app.asar` and uses
`build/icon.ico` for the executable, taskbar and installer.

Refresh the icon after changing the artwork:

```powershell
npm run icon:app     # build/icon.ico + build/icon.png
```

## Release

Versions are driven by `package.json`. Pushing a matching tag builds the app on
GitHub Actions, publishes the installer and portable `.exe` to GitHub Releases,
and deploys `website/` to GitHub Pages:

```powershell
# set "version" in package.json first (e.g. 1.4.0)
git tag v1.4.0
git push origin main v1.4.0
```

The workflow also checks that the tag matches `package.json`, so a stale tag
cannot publish the wrong build.

## Notes

- Store state lives in `localStorage`; the service worker caches only same-origin
  GETs and falls back to the cached shell when offline.
- `.pen` files, if present, are encrypted design sources and are not required to
  build or run the app.
- Builds are unsigned. Windows SmartScreen may ask you to confirm the first run.

## License

MIT — see `LICENSE`.
