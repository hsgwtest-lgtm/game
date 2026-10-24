// SoftEvo 3D B — Service Worker（ネットワーク優先・つながらないときはキャッシュ）
const CACHE = 'softevo3dB-v1';
const ASSETS = [
  './', './index.html', './css/app.css', './manifest.json', './lib/three.min.js',
  './js/app.js', './js/online.js',
  './js/sim/dmath.js', './js/sim/vec.js', './js/sim/model.js', './js/sim/design.js', './js/sim/edit.js', './js/sim/templates.js',
  './js/sim/physics.js', './js/sim/nerves.js', './js/sim/terrain.js', './js/sim/sim.js', './js/sim/gait.js', './js/sim/bout.js',
  './js/evo/cmaes.js', './js/evo/engine.js', './js/evo/worker.js', './js/evo/inherit.js',
  './js/game/world.js', './js/game/game.js', './js/game/store.js', './js/game/traits.js', './js/game/masters.js',
  './js/render/scene.js', './js/render/creature.js', './js/render/planet.js', './js/render/snap.js',
  './js/ui/dom.js', './js/ui/home.js', './js/ui/designer.js', './js/ui/lab.js', './js/ui/tree.js', './js/ui/online.js', './js/ui/arena.js', './js/ui/charts.js', './js/ui/help.js',
  './icons/icon-192.png', './icons/icon-512.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  // オンライン（Firebase）など、ほかのサイトへの通信はキャッシュしない
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request)),
  );
});
