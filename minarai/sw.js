// 自動生成（tools/build_sw.py）: オフラインでも遊べるようにファイルを保存しておく
const CACHE = 'minarai-932d13b743';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/main.js',
  './js/core/arm.js',
  './js/core/bc.js',
  './js/core/db.js',
  './js/core/env.js',
  './js/core/nn.js',
  './js/core/policy.js',
  './js/core/ppo.js',
  './js/core/raster.js',
  './js/core/rng.js',
  './js/core/stages.js',
  './js/core/worker.js',
  './js/game/save.js',
  './js/gfx/charts.js',
  './js/gfx/scene.js',
  './lib/LICENSE-three.txt',
  './lib/three.module.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('minarai-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
