// sw.js — オフラインでも遊べるように、最初に読みこんだときに全ファイルを保存しておく
// ファイルを更新したら VERSION を上げること（新しい版が配られ、古い保存は消える）
const VERSION = 'v1';
const CACHE = `hakoniwa-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icon.svg',
  './lib/three.module.min.js',
  './js/main.js',
  './js/util.js',
  './js/brain.js',
  './js/genetics.js',
  './js/world.js',
  './js/sim.js',
  './js/missions.js',
  './js/render.js',
  './js/input.js',
  './js/charts.js',
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

// 同じ github.io のほかのアプリのキャッシュは消さない（hakoniwa- で始まる古い版だけ消す）
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hakoniwa-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res && res.ok && url.pathname.startsWith(new URL('./', self.location).pathname)) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    )
  );
});
