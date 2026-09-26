// SoftEvo 8 — Service Worker (ネットワーク優先 / オフライン時はキャッシュ)
const CACHE = 'softevo8-v5';
const ASSETS = [
  './', './index.html', './style.css', './manifest.json',
  './js/app.js', './js/sim.js', './js/evo.js', './js/worker.js', './js/builder.js',
  './js/theater.js', './js/brainview.js', './js/charts.js', './js/world.js', './js/store.js', './js/ui.js',
  './js/arena.js', './js/dojo.js', './js/online.js', './js/lobby.js',
  './icons/icon-192.png', './icons/icon-512.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  // オンライン道場 (Firebase) など他のサイトへの通信はキャッシュしない
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request))
  );
});
