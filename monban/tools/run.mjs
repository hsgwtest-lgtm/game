// ヘッドレスのブラウザでページを開き、window.__out を表示する（開発用）
//   node tools/run.mjs tools/bench.html?tiles=4 [timeoutSec]
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

export function serve(port = 0) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      let f = path.join(ROOT, u);
      if (f.endsWith('/')) f += 'index.html';
      fs.readFile(f, (err, data) => {
        if (err) { resp.writeHead(404); resp.end('not found'); return; }
        resp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        resp.end(data);
      });
    });
    srv.listen(port, '127.0.0.1', () => res(srv));
  });
}

export async function launch() {
  return chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
}

if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  const page = process.argv[2] || 'tools/bench.html';
  const timeout = +(process.argv[3] || 600) * 1000;
  const srv = await serve();
  const port = srv.address().port;
  const browser = await launch();
  const pg = await browser.newPage();
  const logs = [];
  pg.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); if (process.env.LIVE) console.log(`[${m.type()}] ${m.text()}`); });
  pg.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await pg.goto(`http://127.0.0.1:${port}/${page}`, { waitUntil: 'commit', timeout: 60000 });
  try {
    await pg.waitForFunction(() => document.title === 'done', null, { timeout, polling: 500 });
  } catch (e) {
    console.log('TIMEOUT');
  }
  const out = await pg.evaluate(() => window.__out);
  if (!process.env.LIVE) console.log(logs.slice(-30).join('\n'));
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
  srv.close();
}
