'use strict';

/*
 * Flip Clock — offline service worker (no build step, no dependencies)
 *
 * Strategy:
 *   • install   — precache the app shell (HTML/CSS/JS/fonts/icons/manifest)
 *   • activate  — drop old caches, claim clients, ask them to refresh
 *   • fetch     — stale-while-revalidate for same-origin GETs;
 *                 navigations fall back to the cached shell when offline
 *
 * Bump CACHE_NAME whenever the shell changes shape (e.g. new required assets).
 */

const CACHE_NAME = 'flip-clock-v1.4.0';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './themes.js',
  './sounds.js',
  './manifest.webmanifest',
  './assets/fonts/bebas-neue-latin.woff2',
  './assets/fonts/bebas-neue-latin-ext.woff2',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-16.png',
  './assets/icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((client) => client.postMessage({ type: 'UPDATE_READY' })))
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // e.g. the lo-fi iframe — let it hit the network or fail on its own

  // Navigations: cached shell first (offline works instantly), refreshed in the background
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Everything else same-origin: stale-while-revalidate
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
