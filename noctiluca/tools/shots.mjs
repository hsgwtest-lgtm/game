// view.html などが window.__out.shots に入れた絵を PNG に保存する（開発用）
//   node tools/shots.mjs "tools/view.html?stage=cradle&gens=4" outdir [timeoutSec]
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch } from './run.mjs';

const page = process.argv[2] || 'tools/view.html';
const outDir = process.argv[3] || '/tmp/shots';
const timeout = +(process.argv[4] || 900) * 1000;
fs.mkdirSync(outDir, { recursive: true });
const srv = await serve();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const pg = await ctx.newPage();
const logs = [];
pg.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
pg.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await pg.goto(`http://127.0.0.1:${srv.address().port}/${page}`, { waitUntil: 'commit' });
try {
  await pg.waitForFunction(() => document.title === 'done', null, { timeout, polling: 500 });
} catch (e) { console.log('TIMEOUT'); }
const out = await pg.evaluate(() => window.__out);
console.log(logs.filter((l) => !l.includes('404')).slice(-20).join('\n'));
if (out) {
  for (const s of out.shots || []) {
    const f = path.join(outDir, s.name + '.png');
    fs.writeFileSync(f, Buffer.from(s.url.split(',')[1], 'base64'));
    console.log('saved', f);
  }
  console.log((out.log || []).join('\n'));
  if (out.eliteRow) fs.writeFileSync(path.join(outDir, 'elite.json'), JSON.stringify({ row: out.eliteRow }));
  if (out.err) console.log('ERR', out.err);
}
await browser.close();
srv.close();
