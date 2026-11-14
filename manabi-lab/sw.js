// sw.js — 初回に読みこんだときに全ファイルを保存し、2回目からはオフラインでも動くようにする
// ファイルを更新したら VERSION を上げること（新しい版が配られ、古い保存は消える）
const VERSION = 'v1';
const CACHE = `manabi-lab-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icon.svg',
  './lib/three.module.min.js',
  './js/main.js',
  './js/defs.js',
  './js/util.js',
  './js/world.js',
  './js/nn.js',
  './js/ga.js',
  './js/qlearn.js',
  './js/species.js',
  './js/methods.js',
  './js/sim.js',
  './js/evaluate.js',
  './js/replay.js',
  './js/icons.js',
  './js/charts.js',
  './js/render.js',
  './js/input.js',
  './js/ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 同じサイトのほかのアプリのキャッシュは消さない（manabi-lab- で始まる古い版だけ消す）
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('manabi-lab-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// まず保存したものを返し、なければネットから取って保存する（このアプリのフォルダの中だけ）
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const scope = new URL('./', self.location).pathname;
  if (!url.pathname.startsWith(scope)) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    )
  );
});
