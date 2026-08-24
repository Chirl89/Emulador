/**
 * NDS Web Emulator - Service Worker
 * Caché offline inteligente (Network-First) para Safari iOS y GitHub Pages
 * Versión: v0.3.1
 */

const CACHE_NAME = 'nds-emulator-v0.3.1';
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
  console.log('[Service Worker] Instalando v0.3.1...');
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (e) => {
  console.log('[Service Worker] Activando v0.3.1 y purgando cachés obsoletas...');
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Eliminada caché antigua:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Estrategia Network-First: Siempre intenta obtener el código más nuevo de la red
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback a caché si no hay conexión a internet
        return caches.match(e.request);
      })
  );
});
