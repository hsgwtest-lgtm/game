const CACHE_NAME = 'softevo-v6';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './engine.js',
  './manifest.json',
  './race.html',
  './race.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c =>
      Promise.all(
        ASSETS.map(url =>
          fetch(new Request(url, { cache: 'reload' }))
            .then(res => c.put(url, res))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(new Request(e.request, { cache: 'no-cache' }))
      .catch(() => caches.match(e.request))
  );
});
