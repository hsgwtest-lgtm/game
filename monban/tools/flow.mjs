// 通しで遊んでみる（開発用）: node tools/flow.mjs outdir
import { serve, launch } from './run.mjs';
const out = process.argv[2] || '/tmp/flow';
import fs from 'node:fs'; fs.mkdirSync(out, { recursive: true });
const srv = await serve(); const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const pg = await ctx.newPage();
const logs = [];
pg.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
pg.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html`, { waitUntil: 'load' });
const shot = (n) => pg.screenshot({ path: `${out}/${n}.png` });
const tapVisitor = async (i) => {
  const p = await pg.evaluate((i) => { const M = window.__monban, s = M.stage, v = s.pool[i].v; const r = s.canvas.getBoundingClientRect();
    const q = v.group.position.clone(); q.y += v.center; q.project(s.cam); return { x: r.left + (q.x * 0.5 + 0.5) * r.width, y: r.top + (-q.y * 0.5 + 0.5) * r.height }; }, i);
  await pg.touchscreen.tap(p.x, p.y); await pg.waitForTimeout(120);
};
const click = async (sel) => { await pg.locator(sel).first().click(); await pg.waitForTimeout(250); };
await click('.hero .btn');               // はじめる
await shot('01-how');
await click('#modal [data-act=ok]');      // あそびかた
await shot('02-intro');
await click('#modal [data-act=go]');
// 止める1体・通す1体を見本にする
const idx = await pg.evaluate(() => { const p = window.__monban.G.level.pool; const big = p.map((c, i) => [c.x[1], i]).sort((a, b) => a[0] - b[0]); return [big[0][1], big[big.length - 1][1]]; });
for (const i of idx) await tapVisitor(i);
await pg.waitForTimeout(900);
await shot('03-teach');
await click('#btn-run'); await pg.waitForTimeout(4500);
await shot('04-run');
await click('#btn-fast'); await pg.waitForTimeout(1500);
await click('#btn-skip'); await pg.waitForTimeout(700);
await shot('05-result');
console.log('stage1', await pg.evaluate(() => JSON.stringify(window.__monban.save.data.stars)));
await click('#modal [data-act=next]');
await shot('06-stage2-intro');
await click('#modal [data-act=go]');
await click('#btn-back');
await shot('07-home');
// 進んだ状態を作って、日替わりと夜勤を見る
await pg.evaluate(() => { const s = window.__monban.save; for (let i = 0; i < 30; i++) s.recordStage(i, { stars: 1 + (i % 3), acc: 0.9, used: 5, method: 'linear' }); });
await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(400);
await shot('08-home-full');
await pg.evaluate(() => document.getElementById('home').scrollTo(0, 99999)); await pg.waitForTimeout(200);
await shot('09-home-bottom');
await pg.evaluate(() => document.getElementById('home').scrollTo(0, 0));
await click('[data-mode=daily]'); await shot('10-daily-intro');
await click('#modal [data-act=go]');
for (const i of [0, 2, 4, 6, 8, 10]) await tapVisitor(i);
await click('.card[data-m=knn]'); await pg.waitForTimeout(800);
await shot('11-daily-teach');
await click('#dial [data-info]'); await shot('12-info'); await click('#modal [data-act=ok]');
await click('#btn-run'); await click('#btn-skip'); await pg.waitForTimeout(700);
await shot('13-daily-result');
await click('#modal [data-act=home]');
await click('[data-mode=night]'); await shot('14-night-intro');
await click('#modal [data-act=go]');
for (let w = 0; w < 12; w++) {
  for (const i of [0, 1, 2, 3]) await tapVisitor(i);
  await click('#btn-run'); await click('#btn-skip'); await pg.waitForTimeout(600);
  if (w === 0) await shot('15-night-result');
  const over = await pg.locator('#modal [data-act=retry]').count();
  if (over) { await shot('16-night-over'); console.log('night over at wave', w + 1); break; }
  await click('#modal [data-act=next]'); await click('#modal [data-act=go]');
}
console.log(await pg.evaluate(() => JSON.stringify({ night: window.__monban.save.data.nightBest, daily: window.__monban.save.data.daily, streak: window.__monban.save.data.streak })));
console.log(logs.slice(0, 20).join('\n') || 'no errors');
await browser.close(); srv.close();
