// クイック対戦のマッチングを試す（モックDB）: node tools/quick_test.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [];
async function client(tag, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => logs.push(`[${tag} pageerror] ${e.message}`));
  await page.addInitScript((nm) => { if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', '1'); localStorage.clear(); localStorage.setItem('nuribots/save/v1', JSON.stringify({ v: 1, seen: { intro: 1 }, profile: { id: 'q_' + nm, name: nm }, online: { bestOf: 1 } })); } }, name);
  await page.goto('http://127.0.0.1:8123/?screen=online&db=http://127.0.0.1:8124');
  return page;
}
const ev = (p, code) => p.evaluate(`(async()=>{ return ${code} })()`);
const waitFor = async (p, code, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(p, code)) return true; await p.waitForTimeout(250); } return false; };
const A = await client('A', 'クイA'), B = await client('B', 'クイB');
await A.waitForTimeout(2500);
await ev(A, `__app.screens.online.start('quick')`);
await waitFor(A, `__app.online.room && __app.online.room.state === 'waiting'`, 15000);
console.log('A waiting in', await ev(A, '__app.online.room.code'), 'quick', await ev(A, '__app.online.room.quick'));
await ev(B, `__app.screens.online.start('quick')`);
const a = await waitFor(A, `__app.curName === 'battle'`, 30000), b = await waitFor(B, `__app.curName === 'battle'`, 30000);
console.log('both in battle', a, b, 'B role', await ev(B, '__app.online.room && __app.online.room.role'));
await waitFor(A, `__app.curName === 'result'`, 70000);
await waitFor(B, `__app.curName === 'result'`, 15000);
console.log('sync', await ev(A, '__app.online.room.checkSync(1)'), 'state', await ev(A, '__app.online.room.state'), await ev(B, '__app.online.room.state'));
console.log(logs.join('\n'));
await browser.close();
