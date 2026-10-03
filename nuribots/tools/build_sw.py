#!/usr/bin/env python3
"""sw.js（オフライン用のキャッシュ）を作り直す: python3 tools/build_sw.py
ファイルの中身のハッシュでキャッシュ名が変わるので、更新すると新しい版が配られる。"""
import hashlib
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {'tools', '.git', 'tmp_test', '__pycache__'}
SKIP_FILES = {'sw.js', 'README.md', '.gitignore'}

TEMPLATE = """// 自動生成（tools/build_sw.py）: オフラインでも遊べるようにファイルを保存しておく
const CACHE = 'nuribots-%(ver)s';
const ASSETS = [
%(assets)s
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
"""


def main():
    files = []
    h = hashlib.sha1()
    for base, dirs, fs in os.walk(ROOT):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith('.'))
        for f in sorted(fs):
            rel = os.path.relpath(os.path.join(base, f), ROOT).replace(os.sep, '/')
            if rel in SKIP_FILES or f.startswith('.') or f.endswith('.txt') or f.endswith('.py'):
                continue
            files.append('./' + rel)
            with open(os.path.join(base, f), 'rb') as fh:
                h.update(rel.encode())
                h.update(fh.read())
    ver = h.hexdigest()[:10]
    assets = ',\n'.join("  '%s'" % p for p in ['./'] + files)
    with open(os.path.join(ROOT, 'sw.js'), 'w', encoding='utf-8') as fh:
        fh.write(TEMPLATE % {'ver': ver, 'assets': assets})
    print('sw.js: %d files, version %s' % (len(files), ver))


if __name__ == '__main__':
    main()
