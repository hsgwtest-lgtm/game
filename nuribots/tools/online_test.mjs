// 2つのブラウザでライブ対戦を通しで試す（モックDBを使う）
//   node tools/mockdb.mjs 8124 &  /  python3 -m http.server 8123 &  のあとで
//   node tools/online_test.mjs <outdir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';

const out = process.argv[2] || 'online';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [];
async function client(tag, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${tag} ${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[${tag} pageerror] ${e.message}`));
  await page.addInitScript((nm) => {
    if (!sessionStorage.getItem('init')) {
      sessionStorage.setItem('init', '1');
      localStorage.clear();
      localStorage.setItem('nuribots/save/v1', JSON.stringify({ v: 1, seen: { intro: 1 }, profile: { id: 'p_' + nm, name: nm }, online: { bestOf: 3 } }));
    }
  }, name);
  await page.goto('http://127.0.0.1:8123/?safe=47,34&screen=online&db=http://127.0.0.1:8124');
  return page;
}
const A = await client('A', 'アリス');
const B = await client('B', 'ボブ');
await A.waitForTimeout(2500);
const ev = (p, code) => p.evaluate(`(async()=>{ return ${code} })()`);
const waitFor = async (p, code, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(p, code)) return true; await p.waitForTimeout(250); }
  return false;
};
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png` });

console.log('A online status', await ev(A, '__app.online.status'));
await ev(A, `__app.screens.online.start('create')`);
await waitFor(A, `__app.online.room && __app.online.room.code`);
const code = await ev(A, '__app.online.room.code');
console.log('room code', code);
await A.waitForTimeout(500);
await shot(A, '01_waiting');
await ev(B, `__app.screens.online.start('join', '${code}')`);
const okA = await waitFor(A, `__app.curName === 'battle'`, 30000);
const okB = await waitFor(B, `__app.curName === 'battle'`, 30000);
console.log('both in battle', okA, okB);
await A.waitForTimeout(4500);
await shot(A, '02_battleA_intro');
await A.waitForTimeout(6000);
await ev(B, `__app.online.room.sendEmote(2)`);
await A.waitForTimeout(800);
await shot(A, '03_battleA');
await shot(B, '03_battleB');
const tA = await ev(A, '__app.spec.env && __app.spec.env.t');
const tB = await ev(B, '__app.spec.env && __app.spec.env.t');
console.log('step A/B during battle', tA, tB);
// 1回戦の終わりを待つ
await waitFor(A, `__app.curName === 'result'`, 70000);
await waitFor(B, `__app.curName === 'result'`, 20000);
await A.waitForTimeout(1500);
await shot(A, '04_resultA');
console.log('round1 sync', await ev(A, '__app.online.room.checkSync(1)'), await ev(B, '__app.online.room.checkSync(1)'));
console.log('round1 results', JSON.stringify(await ev(A, '__app.online.room.results')), JSON.stringify(await ev(B, '__app.online.room.results')));
// 作戦タイム（結果画面から7秒で自動）
await waitFor(A, `__app.curName === 'room' && __app.online.room.state === 'plan'`, 20000);
await waitFor(B, `__app.curName === 'room' && __app.online.room.state === 'plan'`, 20000);
await A.waitForTimeout(6000);
await shot(A, '05_planA');
console.log('plan A iter', await ev(A, `__app.screens.room.planIter && __app.screens.room.planIter.steps`));
await ev(A, '__app.screens.room.submitPlan()');
await A.waitForTimeout(1500);
await shot(A, '06_submittedA');
await ev(B, '__app.screens.room.submitPlan()');
const ok2 = await waitFor(A, `__app.curName === 'battle'`, 30000);
console.log('round2 battle', ok2, await waitFor(B, `__app.curName === 'battle'`, 10000));
await A.waitForTimeout(12000);
await shot(A, '07_round2A');
await waitFor(A, `__app.curName === 'result'`, 70000);
await waitFor(B, `__app.curName === 'result'`, 20000);
await A.waitForTimeout(1000);
await shot(A, '08_result2A');
console.log('round2 sync', await ev(A, '__app.online.room.checkSync(2)'));
console.log('state after r2', await ev(A, '__app.online.room.state'), JSON.stringify(await ev(A, '__app.online.room.wins()')));
const over = await ev(A, `__app.online.room.state === 'over'`);
if (!over) {
  await waitFor(A, `__app.curName === 'room' && __app.online.room.state === 'plan'`, 20000);
  await waitFor(B, `__app.curName === 'room' && __app.online.room.state === 'plan'`, 20000);
  await A.waitForTimeout(3000);
  await ev(A, '__app.screens.room.submitPlan()');
  await ev(B, '__app.screens.room.submitPlan()');
  await waitFor(A, `__app.curName === 'battle'`, 30000);
  await waitFor(A, `__app.curName === 'result'`, 75000);
  await A.waitForTimeout(1000);
  console.log('round3 sync', await ev(A, '__app.online.room.checkSync(3)'));
}
await ev(A, `__app.go('room', {})`);
await ev(B, `__app.go('room', {})`);
await A.waitForTimeout(1500);
console.log('final state', await ev(A, '__app.online.room.state'), JSON.stringify(await ev(A, '__app.online.room.wins()')));
await shot(A, '09_overA');
// もう一回
await ev(A, `__app.online.room.voteRematch()`);
await ev(B, `__app.online.room.voteRematch()`);
const rm = await waitFor(A, `__app.curName === 'battle'`, 30000);
console.log('rematch battle', rm);
await A.waitForTimeout(3000);
await shot(A, '10_rematchA');
const fa = await ev(A, '__app.fatal'), fb = await ev(B, '__app.fatal');
if (fa) logs.push('[A fatal] ' + fa);
if (fb) logs.push('[B fatal] ' + fb);
console.log(logs.join('\n'));
await browser.close();
