var CACHE_NAME = 'modelingA-3d-modeler-v1.0.0';

var APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/csg.js',
  './js/exporter.js',
  './js/storage.js'
];

var CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/TransformControls.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      var cdnPromises = CDN_ASSETS.map(function (url) {
        return cache.add(url).catch(function () {});
      });
      return cache.addAll(APP_SHELL).then(function () { return Promise.all(cdnPromises); });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);
  var isExternal = url.origin !== location.origin;

  if (isExternal) {
    event.respondWith(
      fetch(event.request)
        .then(function (response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, clone); });
          }
          return response;
        })
        .catch(function () { return caches.match(event.request); })
    );
  } else {
    event.respondWith(
      caches.match(event.request)
        .then(function (cached) {
          if (cached) return cached;
          return fetch(event.request).then(function (response) {
            if (response.ok) {
              var clone = response.clone();
              caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, clone); });
            }
            return response;
          });
        })
        .catch(function () { return caches.match('./index.html'); })
    );
  }
});
