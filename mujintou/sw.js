// Service Worker
//   シェル（画面・プログラム・Three.js・アイコン）… キャッシュ優先。オフラインでも開ける。
//   data/*.json（島の状態・名簿。data/demo/ も）   … ネットワーク優先。島の更新がすぐ届く。
//                                                   通信できないとき（または遅いとき）は前回の控えで開く。
//
// プログラム（シェル）を変えたら VERSION を上げること。
// 新しい版は裏で取り込まれ、画面が裏に回ったとき（アプリを閉じた・切り替えた）に入れ替わる（main.js）。
// データ（data/*.json）だけの更新では VERSION を上げる必要はない。

const VERSION = '2026-11-16.1';
const SHELL_CACHE = `mujintou-shell-${VERSION}`;
const DATA_CACHE = 'mujintou-data'; // 版をまたいで使う、データの控え
const DATA_TIMEOUT_MS = 4000; // これ以上待たされたら、控えがあれば控えを返す

const SHELL = [
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './css/style.css',
  './js/main.js',
  './js/config.js',
  './js/data.js',
  './js/ui.js',
  './js/pixelart.js',
  './js/rng.js',
  './js/zoom.js',
  './js/terrain.js',
  './js/buildings.js',
  './js/pathfind.js',
  './js/sim.js',
  './js/world.js',
  './js/actors.js',
  './js/camera.js',
  './lib/three.module.js',
];
const DATA = ['./data/state.json', './data/islanders.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));
      // データの控えも取っておく（取れなくてもインストールは続ける）
      const data = await caches.open(DATA_CACHE);
      await Promise.all(
        DATA.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res.ok) await data.put(url, res);
          } catch {
            // 圏外など。次にネットワークから取れたときに控える
          }
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('mujintou-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// main.js から「いま入れ替えてよい」と言われたら、待たずに新しい版へ
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length); // 例：'' / 'index.html' / 'js/main.js' / 'data/state.json'

  if (/^data\/.+\.json$/.test(path)) {
    event.respondWith(networkFirst(event, req));
    return;
  }
  if (req.mode === 'navigate') {
    // 島のページ（?who= などの付いたものも）はシェルの index.html を返す。それ以外のページは素通し。
    if (path === '' || path === 'index.html') event.respondWith(cacheFirst(event, './index.html'));
    return;
  }
  event.respondWith(cacheFirst(event, req));
});

async function cacheFirst(event, request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') event.waitUntil(cache.put(request, res.clone()));
  return res;
}

function networkFirst(event, request) {
  const cachePromise = caches.open(DATA_CACHE);
  const network = fetch(request);
  // ネットワークから取れた最新のデータは、時間切れで控えを返したあとでも控えておく
  event.waitUntil(
    network
      .then((res) => {
        if (!res.ok) return undefined;
        const copy = res.clone();
        return cachePromise.then((cache) => cache.put(request, copy));
      })
      .catch(() => {}),
  );
  return (async () => {
    const cached = await (await cachePromise).match(request, { ignoreVary: true });
    try {
      const res = await (cached ? Promise.race([network, timeout(DATA_TIMEOUT_MS)]) : network);
      return res.ok || !cached ? res : cached;
    } catch (err) {
      if (cached) return cached;
      throw err;
    }
  })();
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}
