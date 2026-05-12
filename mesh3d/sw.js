const CACHE_NAME = 'mesh3d-v1';
const MODEL_CACHE = 'mesh3d-models-v1';

// App shell assets (precached on install)
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== MODEL_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Model files (ONNX, tokenizer, config from HF) → cache-first with network fallback
  if (url.hostname === 'huggingface.co' || url.hostname.endsWith('.hf.co') ||
      url.hostname === 'cdn-lfs.huggingface.co' || url.hostname === 'cdn-lfs-us-1.huggingface.co') {
    e.respondWith(modelCacheFirst(e.request));
    return;
  }

  // CDN libraries (Three.js, Transformers.js) → cache-first
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'unpkg.com') {
    e.respondWith(cdnCacheFirst(e.request));
    return;
  }

  // App shell → stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => null);
      return cached || network;
    })
  );
});

async function modelCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(MODEL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Model file unavailable offline', { status: 503 });
  }
}

async function cdnCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('CDN resource unavailable offline', { status: 503 });
  }
}
