const CACHE_NAME = 'casino-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './style/global.css',
  './js/main.js',
  './js/audio.js',
  './js/chips.js',
  './js/card.js',
  './js/utils.js',
  './games/slots/slots.html',
  './games/slots/slots.js',
  './games/slots/slots.css',
  './games/blackjack/blackjack.html',
  './games/blackjack/blackjack.js',
  './games/blackjack/blackjack.css',
  './games/roulette/roulette.html',
  './games/roulette/roulette.js',
  './games/roulette/roulette.css',
  './games/baccarat/baccarat.html',
  './games/baccarat/baccarat.js',
  './games/baccarat/baccarat.css',
  './games/dragon-tiger/dragon-tiger.html',
  './games/dragon-tiger/dragon-tiger.js',
  './games/dragon-tiger/dragon-tiger.css',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
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
