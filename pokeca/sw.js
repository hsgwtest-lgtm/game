// ポケカ番号サーチ service worker
// アプリ本体+索引は事前キャッシュ、弾ごとの詳細とカード画像は見たものから順にキャッシュ
const VER = 'pokeca-v1';
const CORE = ['./', './index.html', './style.css', './app.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './data/index.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('pokeca-') && k !== VER && k !== 'pokeca-img').map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // カード画像: cache-first（別キャッシュで長期保持）
  if (url.hostname === 'assets.tcgdex.net') {
    e.respondWith(caches.open('pokeca-img').then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // 同一オリジン: stale-while-revalidate
  e.respondWith(caches.open(VER).then(async (c) => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
