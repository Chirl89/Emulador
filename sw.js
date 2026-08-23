/**
 * NDS Web Emulator - Service Worker
 * Caché offline para Safari iOS y GitHub Pages
 * Versión: v0.0.1
 */

const CACHE_NAME = 'nds-emulator-v0.0.1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './VERSION',
  './manifest.json',
  './css/style.css',
  './css/touch-controls.css',
  './js/app.js',
  './js/gamepad.js',
  './js/save-manager.js',
  './js/touch-controls.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Cacheando activos principales...');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Eliminando caché antigua:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Para peticiones externas a la CDN de WebAssembly, responder por red primero y fallback a cache
  if (e.request.url.includes('cdn.emulatorjs.org')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
