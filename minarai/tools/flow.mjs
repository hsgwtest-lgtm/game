// 通し確認（開発用）: ヘッドレスのブラウザで実際に操作して、学習が進むところまで見る
//   node tools/flow.mjs [stage] [shotDir]
import { serve, launch } from './run.mjs';
import fs from 'node:fs';
const stage = process.argv[2] || 'grasp', dir = process.argv[3] || 'tools/out';
fs.mkdirSync(dir, { recursive: true });
const srv = await serve();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const pg = await ctx.newPage();
const logs = [];
pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
pg.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
const shot = (n) => pg.screenshot({ path: `${dir}/${n}.png` });
const ui = () => pg.evaluate(() => { const u = window.__app.ui; return { job: u.job, step: u.step, method: u.method, demos: u.demos, slot: u.slots[u.method], examOut: u.examOut }; });
const waitJobEnd = async (max) => { const t0 = Date.now(); while (Date.now() - t0 < max) { if (!(await ui()).job) return true; await pg.waitForTimeout(300); } return false; };

await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html?s=${stage}&m=bc`, { waitUntil: 'load' });
for (let i = 0; i < 100 && await pg.evaluate(() => window.__app.ui.opening || !window.__app.ui.liveKey); i++) await pg.waitForTimeout(100);
await pg.waitForTimeout(600);
await pg.evaluate(() => { document.querySelector('#modal').hidden = true; });
await shot('1-teach');
// 指でなぞる: 机の上を何か所かドラッグ
const box = await pg.locator('#gl').boundingBox();
await pg.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await pg.mouse.down();
for (let i = 0; i <= 20; i++) { await pg.mouse.move(box.x + box.width * (0.5 + 0.25 * Math.cos(i / 4)), box.y + box.height * (0.55 + 0.15 * Math.sin(i / 4))); await pg.waitForTimeout(80); }
await pg.mouse.up();
await shot('2-dragged');
console.log('ドラッグ後', JSON.stringify(await pg.evaluate(() => document.querySelector('#status').textContent)));
// お手本ロボ ×3（30本）→ まねる
for (let i = 0; i < 3; i++) { await pg.click('#btn-robot'); await pg.waitForTimeout(250); }
console.log('お手本', JSON.stringify((await ui()).demos));
await pg.evaluate(() => window.__app.setStep('learn'));
await pg.waitForTimeout(300);
await pg.click('#btn-bc');
await pg.waitForTimeout(2500);
await shot('3-learning');
console.log('模倣学習 終了', await waitJobEnd(240000), JSON.stringify((({ ready, bcEpochs, estimate, bcDemos }) => ({ ready, bcEpochs, estimate, bcDemos }))((await ui()).slot)));
await pg.waitForTimeout(1500);
await shot('4-learned');
// 検定
await pg.evaluate(() => window.__app.setStep('exam'));
await pg.click('#btn-exam');
await pg.waitForTimeout(1200);
await shot('5-exam-running');
console.log('検定 終了', await waitJobEnd(120000), JSON.stringify((await ui()).examOut));
await shot('6-exam');
// 強化学習だけ
await pg.evaluate(() => { window.__app.setMethod('rl'); window.__app.setStep('practice'); });
await pg.waitForTimeout(400);
await shot('7-rl-before');
await pg.click('#btn-rl');
const t0 = Date.now();
for (let k = 0; k < 6; k++) {
  await pg.waitForTimeout(10000);
  const s = (await ui()).slot;
  console.log(`強化学習 ${Math.round((Date.now() - t0) / 1000)}秒: ${s.rlSteps}歩 成功率${Math.round((s.estimate || 0) * 100)}% 速さ ${await pg.evaluate(() => Math.round(window.__app.ui.rl && window.__app.ui.rl.sps || 0))}歩/秒`);
}
await shot('8-rl-running');
await pg.click('#btn-rl');
await waitJobEnd(10000);
await pg.evaluate(() => window.__app.setStep('exam'));
await pg.click('#btn-exam');
console.log('検定(強化) 終了', await waitJobEnd(120000), JSON.stringify((await ui()).examOut));
await pg.evaluate(() => window.__app.setStep('cmp'));
await pg.waitForTimeout(500);
await shot('9-compare');
await pg.click('#btn-back');
await pg.waitForTimeout(500);
await shot('10-home');
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 20).join('\n') || 'コンソールにエラーなし');
await browser.close(); srv.close();
