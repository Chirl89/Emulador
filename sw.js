/**
 * NDS Web Emulator - Service Worker
 * Caché offline inteligente (Network-First) para Safari iOS y GitHub Pages
 * Versión: v0.9.3
 */

const CACHE_NAME = 'nds-emulator-v0.9.3';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './VERSION',
  './manifest.json',
  './css/style.css',
  './css/touch-controls.css',
  './js/cloud-save-manager.js',
  './js/app.js',
  './js/gamepad.js',
  './js/save-manager.js',
  './js/touch-controls.js'
];

self.addEventListener('install', (e) => {
  console.log('[Service Worker] Instalando v0.9.3...');
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('[Service Worker] Falló cacheo de algunos assets:', err);
      });
    })
  );
});

self.addEventListener('activate', (e) => {
  console.log('[Service Worker] Activando v0.9.3 y purgando cachés obsoletas...');
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
  // Ignorar peticiones a CDNs de EmulatorJS, scripts externos y llamadas de PubNub
  if (!e.request.url.startsWith(self.location.origin) ||
      e.request.url.includes('cdn.emulatorjs.org') ||
      e.request.url.includes('pubnub.com')) {
    return;
  }

  // Network-First para assets de la aplicación (garantiza código siempre actualizado en Safari iOS)
  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(e.request);
      })
  );
});
