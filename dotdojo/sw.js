// 自動生成（tools/build_sw.py）: オフラインでも遊べるようにファイルをキャッシュする
const CACHE = 'dotdojo-0a163161ff';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/main.js',
  './js/core/audio.js',
  './js/core/config.js',
  './js/core/rng.js',
  './js/core/storage.js',
  './js/game/masters.js',
  './js/game/session.js',
  './js/game/state.js',
  './js/gfx/fb.js',
  './js/gfx/font.js',
  './js/gfx/fontdata.js',
  './js/gfx/pixel.js',
  './js/gfx/sprites.js',
  './js/ml/bc.js',
  './js/ml/ga.js',
  './js/ml/nn.js',
  './js/ml/ppo.js',
  './js/screens/compare.js',
  './js/screens/ga.js',
  './js/screens/howto.js',
  './js/screens/il.js',
  './js/screens/menu.js',
  './js/screens/records.js',
  './js/screens/rl.js',
  './js/screens/settings.js',
  './js/screens/stages.js',
  './js/screens/test.js',
  './js/screens/title.js',
  './js/screens/train.js',
  './js/sim/env.js',
  './js/sim/evaluate.js',
  './js/sim/planner.js',
  './js/sim/stages.js',
  './js/ui/ui.js',
  './js/ui/viz.js',
  './js/ui/widgets.js',
  './js/world/world3d.js',
  './lib/three.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dotdojo-') && k !== CACHE).map((k) => caches.delete(k))))
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
