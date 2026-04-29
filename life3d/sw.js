/* ─────────────────────────────────────────────────────────────
   3D Life Grid – Service Worker
   Strategy: Cache-first with network fallback.
   Bump CACHE_VERSION to force update on deploy.
───────────────────────────────────────────────────────────── */

const CACHE_VERSION = 'v1.2.0';
const CACHE_NAME    = `life3d-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;700;900&display=swap',
];

// ── Install: pre-cache all static assets ─────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())          // activate immediately
  );
});

// ── Activate: prune old caches ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('life3d-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())         // take control immediately
  );
});

// ── Fetch: cache-first, then network, then offline fallback ──
self.addEventListener('fetch', event => {
  // Skip non-GET or chrome-extension requests
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http'))  return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          // Only cache successful, non-opaque responses
          if (
            response &&
            response.status === 200 &&
            response.type !== 'opaque'
          ) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback: serve index.html for navigate requests
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});

// ── Message: manual cache clear ──────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
