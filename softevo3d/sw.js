// 自動生成（tools/build_sw.py）: オフラインでも遊べるようにファイルをキャッシュする
const CACHE = 'softevo3d-d2260dbbe6';
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
  './js/core/db.js',
  './js/core/rng.js',
  './js/core/share.js',
  './js/evo/ga.js',
  './js/evo/growth.js',
  './js/evo/pool.js',
  './js/evo/session.js',
  './js/evo/worker.js',
  './js/game/demo.js',
  './js/gfx/fb.js',
  './js/gfx/font.js',
  './js/gfx/fontdata.js',
  './js/gfx/icons.js',
  './js/gfx/pixel.js',
  './js/screens/build.js',
  './js/screens/lab.js',
  './js/screens/parade.js',
  './js/screens/settings.js',
  './js/screens/title.js',
  './js/screens/zukan.js',
  './js/sim/body.js',
  './js/sim/brain.js',
  './js/sim/creature.js',
  './js/sim/dmath.js',
  './js/sim/presets.js',
  './js/sim/terrain.js',
  './js/ui/iso.js',
  './js/ui/labui.js',
  './js/ui/overlay.js',
  './js/ui/ui.js',
  './js/ui/viz.js',
  './js/ui/widgets.js',
  './js/world/actor.js',
  './js/world/buildview.js',
  './js/world/voxmesh.js',
  './js/world/world3d.js',
  './lib/three.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('softevo3d-') && k !== CACHE).map((k) => caches.delete(k))))
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
