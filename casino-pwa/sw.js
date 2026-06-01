const CACHE_NAME = 'cebu-casino-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './style/global.css',
  './js/main.js',
  './js/chips.js',
  './js/audio.js',
  './js/utils.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './games/dragon-tiger/dragon-tiger.html',
  './games/dragon-tiger/dragon-tiger.js',
  './games/dragon-tiger/dragon-tiger.css',
  './games/blackjack/blackjack.html',
  './games/blackjack/blackjack.js',
  './games/blackjack/blackjack.css',
  './games/baccarat/baccarat.html',
  './games/baccarat/baccarat.js',
  './games/baccarat/baccarat.css',
  './games/slots/slots.html',
  './games/slots/slots.js',
  './games/slots/slots.css',
  './games/roulette/roulette.html',
  './games/roulette/roulette.js',
  './games/roulette/roulette.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
