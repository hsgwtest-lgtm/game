// 自動生成（tools/build_sw.py）: オフラインでも遊べるようにファイルを保存しておく
const CACHE = 'monban-bb2eeb69a4';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/LICENSE-dads-tokens.txt',
  './css/app.css',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/main.js',
  './js/game/gen.js',
  './js/game/level.js',
  './js/game/rules.js',
  './js/game/save.js',
  './js/game/stages.js',
  './js/gfx/brain.js',
  './js/gfx/scene.js',
  './js/gfx/util.js',
  './js/gfx/visitor.js',
  './js/ml/models.js',
  './js/ml/rng.js',
  './js/ui/map.js',
  './lib/LICENSE-three.txt',
  './lib/three.module.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('monban-') && k !== CACHE).map((k) => caches.delete(k))))
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
