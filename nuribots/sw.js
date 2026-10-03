// 自動生成（tools/build_sw.py）: オフラインでも遊べるようにファイルを保存しておく
const CACHE = 'nuribots-319ae5da16';
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
  './js/core/const.js',
  './js/core/rng.js',
  './js/core/store.js',
  './js/game/coach.js',
  './js/game/league.js',
  './js/game/save.js',
  './js/game/spectator.js',
  './js/gfx/fb.js',
  './js/gfx/font.js',
  './js/gfx/fontdata.js',
  './js/gfx/pixel.js',
  './js/gfx/sprites.js',
  './js/gfx/world3d.js',
  './js/ml/boss.js',
  './js/ml/bosses.js',
  './js/ml/mathx.js',
  './js/ml/net.js',
  './js/ml/policy.js',
  './js/ml/ppo.js',
  './js/ml/train.worker.js',
  './js/ml/trainclient.js',
  './js/ml/trainer.js',
  './js/net/fire.js',
  './js/net/online.js',
  './js/screens/album.js',
  './js/screens/battle.js',
  './js/screens/design.js',
  './js/screens/ghosts.js',
  './js/screens/home.js',
  './js/screens/howto.js',
  './js/screens/league.js',
  './js/screens/name.js',
  './js/screens/online.js',
  './js/screens/result.js',
  './js/screens/room.js',
  './js/screens/settings.js',
  './js/screens/title.js',
  './js/screens/train.js',
  './js/sim/arenas.js',
  './js/sim/bots.js',
  './js/sim/env.js',
  './js/sim/match.js',
  './js/sim/rewards.js',
  './js/ui/charts.js',
  './js/ui/deckedit.js',
  './js/ui/input.js',
  './js/ui/keyboard.js',
  './js/ui/layout.js',
  './js/ui/ui.js',
  './js/ui/widgets.js',
  './lib/three.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nuribots-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // オンライン対戦（Firebase）など、ほかのサイトへの通信はそのまま
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
