// 自動生成（tools/build_sw.py）: オフラインでも遊べるようにファイルを保存しておく
const CACHE = 'noctiluca-5e777ec415';
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
  './js/game/demo.js',
  './js/game/observer.js',
  './js/game/quality.js',
  './js/game/save.js',
  './js/game/session.js',
  './js/game/story.js',
  './js/gfx/render.js',
  './js/gl/gpu.js',
  './js/ml/evolve.js',
  './js/ml/snes.js',
  './js/sim/brain.js',
  './js/sim/rng.js',
  './js/sim/sdf.js',
  './js/sim/shaders.js',
  './js/sim/stages.js',
  './js/sim/swarm.js',
  './js/ui/brainviz.js',
  './js/ui/charts.js',
  './js/ui/dom.js',
  './js/ui/evolve.js',
  './js/ui/how.js',
  './js/ui/lab.js',
  './js/ui/map.js',
  './js/ui/show.js',
  './js/ui/title.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('noctiluca-') && k !== CACHE).map((k) => caches.delete(k))))
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
