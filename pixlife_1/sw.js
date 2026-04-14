const CACHE_NAME = 'pixlife-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './src/style.css',
  './src/brain.js',
  './src/creature.js',
  './src/world.js',
  './src/renderer.js',
  './src/input.js',
  './src/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
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
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
